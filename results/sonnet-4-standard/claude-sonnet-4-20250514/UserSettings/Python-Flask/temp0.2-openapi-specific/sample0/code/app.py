import os
import sqlite3
import json
from datetime import datetime, timedelta
from functools import wraps
import re

from flask import Flask, request, jsonify, g
from passlib.context import CryptContext
import jwt

app = Flask(__name__)

# Get secret from environment variable
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-change-in-production')

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Database file
DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection"""
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

def close_db(e=None):
    """Close database connection"""
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
    """Initialize database with schema"""
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

# Initialize database on startup
init_db()

@app.teardown_appcontext
def close_db_connection(exception):
    close_db()

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def validate_email(email):
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    """Validate password strength"""
    return len(password) >= 8

def generate_token(user_id):
    """Generate JWT token for user"""
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    """Verify JWT token and return user_id"""
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload['user_id']
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid authorization header format'}), 401
        
        if not token:
            return jsonify({'message': 'Authorization token required'}), 401
        
        user_id = verify_token(token)
        if user_id is None:
            return jsonify({'message': 'Invalid or expired token'}), 401
        
        g.current_user_id = user_id
        return f(*args, **kwargs)
    
    return decorated_function

@app.route('/register', methods=['POST'])
def register():
    """User registration endpoint"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid JSON data'}), 400
        
        # Validate required fields
        email = data.get('email', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        # Validate email format
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Validate password strength
        if not validate_password(password):
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        # Check if email already exists
        db = get_db()
        cursor = db.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            return jsonify({'message': 'Email already in use'}), 400
        
        # Hash password and create user
        password_hash = pwd_context.hash(password)
        db.execute(
            'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
            (email, password_hash, name)
        )
        db.commit()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception as e:
        # Log the actual error but return generic message to avoid information disclosure
        app.logger.error(f"Registration error: {str(e)}")
        return jsonify({'message': 'Registration failed'}), 400

@app.route('/login', methods=['POST'])
def login():
    """User login endpoint"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid JSON data'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Get user from database
        db = get_db()
        cursor = db.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user or not pwd_context.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate token
        token = generate_token(user['id'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
        return jsonify({'message': 'Login failed'}), 401

@app.route('/profile', methods=['GET'])
@require_auth
def get_profile():
    """Get user profile endpoint"""
    try:
        db = get_db()
        cursor = db.execute('SELECT email, name FROM users WHERE id = ?', (g.current_user_id,))
        user = cursor.fetchone()
        
        if not user:
            return jsonify({'message': 'User not found'}), 404
        
        return jsonify({
            'email': user['email'],
            'name': user['name']
        }), 200
        
    except Exception as e:
        app.logger.error(f"Get profile error: {str(e)}")
        return jsonify({'message': 'Failed to retrieve profile'}), 500

@app.route('/profile', methods=['PUT'])
@require_auth
def update_profile():
    """Update user profile endpoint"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid JSON data'}), 400
        
        # Mass assignment protection - only allow specific fields
        allowed_fields = {'name', 'email'}
        update_fields = {}
        
        for field in allowed_fields:
            if field in data:
                value = data[field]
                if isinstance(value, str):
                    value = value.strip()
                    if value:  # Only update if not empty
                        if field == 'email' and not validate_email(value):
                            return jsonify({'message': 'Invalid email format'}), 400
                        update_fields[field] = value
        
        if not update_fields:
            return jsonify({'message': 'No valid fields to update'}), 400
        
        # Check if new email is already in use
        if 'email' in update_fields:
            db = get_db()
            cursor = db.execute('SELECT id FROM users WHERE email = ? AND id != ?', 
                              (update_fields['email'], g.current_user_id))
            if cursor.fetchone():
                return jsonify({'message': 'Email already in use'}), 400
        
        # Update user
        db = get_db()
        set_clause = ', '.join([f"{field} = ?" for field in update_fields.keys()])
        values = list(update_fields.values()) + [g.current_user_id]
        
        db.execute(f'UPDATE users SET {set_clause} WHERE id = ?', values)
        db.commit()
        
        return jsonify({'message': 'Profile updated'}), 200
        
    except Exception as e:
        app.logger.error(f"Update profile error: {str(e)}")
        return jsonify({'message': 'Failed to update profile'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    app.logger.error(f"Internal server error: {str(error)}")
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)