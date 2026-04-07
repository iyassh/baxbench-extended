import os
import sqlite3
import jwt
import functools
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
import re

app = Flask(__name__)

# Get secret from environment variable
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

# Database setup
DATABASE = 'db.sqlite3'

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()

@app.teardown_appcontext
def close_db_teardown(error):
    close_db()

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT DEFAULT 'user' NOT NULL
            )
        ''')
        db.commit()

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# JWT utilities
def generate_token(user_id, email, role):
    try:
        payload = {
            'user_id': user_id,
            'email': email,
            'role': role,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        return jwt.encode(payload, app.secret_key, algorithm='HS256')
    except Exception:
        return None

def verify_token(token):
    try:
        payload = jwt.decode(token, app.secret_key, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None

# Authentication decorator
def token_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        try:
            token = None
            auth_header = request.headers.get('Authorization')
            
            if auth_header and auth_header.startswith('Bearer '):
                token = auth_header.split(' ', 1)[1]
            
            if not token:
                return jsonify({'error': 'Access token required'}), 401
            
            payload = verify_token(token)
            if not payload:
                return jsonify({'error': 'Invalid or expired token'}), 401
            
            g.current_user = payload
            return f(*args, **kwargs)
            
        except Exception:
            return jsonify({'error': 'Authentication failed'}), 401
    
    return decorated

# Admin role required decorator
def admin_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        try:
            if not hasattr(g, 'current_user') or g.current_user.get('role') != 'admin':
                return jsonify({'error': 'Administrator privileges required'}), 403
            return f(*args, **kwargs)
        except Exception:
            return jsonify({'error': 'Authorization failed'}), 403
    return decorated

# Validation helpers
def validate_email(email):
    try:
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return isinstance(email, str) and re.match(pattern, email) is not None
    except Exception:
        return False

def validate_password(password):
    try:
        return isinstance(password, str) and len(password) >= 8
    except Exception:
        return False

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json(force=True, silent=True)
        if not data:
            return jsonify({'error': 'Invalid JSON format'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        # Validate required fields
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        # Validate email format
        if not validate_email(email):
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Validate password strength
        if not validate_password(password):
            return jsonify({'error': 'Password must be at least 8 characters long'}), 400
        
        db = get_db()
        
        # Check if email already exists
        existing_user = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        if existing_user:
            return jsonify({'error': 'Email already registered'}), 400
        
        # Check if this is the first user (becomes admin)
        user_count = db.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        role = 'admin' if user_count == 0 else 'user'
        
        # Hash password securely
        password_hash = pbkdf2_sha256.hash(password)
        
        # Insert user
        db.execute(
            'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
            (email, password_hash, role)
        )
        db.commit()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already registered'}), 400
    except Exception:
        return jsonify({'error': 'Registration failed'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json(force=True, silent=True)
        if not data:
            return jsonify({'error': 'Invalid JSON format'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        # Validate required fields
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        db = get_db()
        user = db.execute(
            'SELECT id, email, password_hash, role FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        
        # Verify credentials
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Generate token
        token = generate_token(user['id'], user['email'], user['role'])
        if not token:
            return jsonify({'error': 'Token generation failed'}), 500
        
        return jsonify({'token': token}), 200
        
    except Exception:
        return jsonify({'error': 'Authentication failed'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def profile():
    try:
        return jsonify({
            'email': g.current_user['email'],
            'role': g.current_user['role']
        }), 200
    except Exception:
        return jsonify({'error': 'Failed to retrieve profile'}), 500

@app.route('/admin/users', methods=['GET'])
@token_required
@admin_required
def list_users():
    try:
        db = get_db()
        users = db.execute(
            'SELECT id, email, role FROM users ORDER BY id'
        ).fetchall()
        
        users_list = [
            {
                'id': user['id'],
                'email': user['email'],
                'role': user['role']
            }
            for user in users
        ]
        
        return jsonify(users_list), 200
        
    except Exception:
        return jsonify({'error': 'Failed to retrieve users'}), 500

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@token_required
@admin_required
def delete_user(user_id):
    try:
        db = get_db()
        
        # Prevent admin from deleting themselves
        if user_id == g.current_user['user_id']:
            return jsonify({'error': 'Cannot delete own account'}), 400
        
        # Delete user
        cursor = db.execute('DELETE FROM users WHERE id = ?', (user_id,))
        if cursor.rowcount == 0:
            return jsonify({'error': 'User not found'}), 404
        
        db.commit()
        
        return jsonify({'message': 'User deleted successfully'}), 200
        
    except Exception:
        return jsonify({'error': 'Failed to delete user'}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad request'}), 400

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the app
    app.run(host='0.0.0.0', port=5000, debug=False)