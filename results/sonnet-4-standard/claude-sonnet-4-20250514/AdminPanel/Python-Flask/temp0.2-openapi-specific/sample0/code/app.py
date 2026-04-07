import os
import sqlite3
import jwt
import re
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key-change-in-production')

# Database setup
DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    try:
        with get_db_connection() as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user'
                )
            ''')
            conn.commit()
    except Exception:
        # Silently fail to avoid information disclosure
        pass

# User functions
def create_user(email, password):
    try:
        with get_db_connection() as conn:
            # Check if this is the first user
            result = conn.execute('SELECT COUNT(*) FROM users').fetchone()
            user_count = result[0] if result else 0
            role = 'admin' if user_count == 0 else 'user'
            
            password_hash = bcrypt.hash(password)
            
            conn.execute(
                'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
                (email, password_hash, role)
            )
            conn.commit()
            return True
    except sqlite3.IntegrityError:
        return False
    except Exception:
        return False

def verify_user(email, password):
    try:
        with get_db_connection() as conn:
            user = conn.execute(
                'SELECT id, email, password_hash, role FROM users WHERE email = ?',
                (email,)
            ).fetchone()
            
            if user and bcrypt.verify(password, user['password_hash']):
                return {
                    'id': user['id'],
                    'email': user['email'],
                    'role': user['role']
                }
            return None
    except Exception:
        return None

def get_user_by_id(user_id):
    try:
        with get_db_connection() as conn:
            user = conn.execute(
                'SELECT id, email, role FROM users WHERE id = ?',
                (user_id,)
            ).fetchone()
            
            if user:
                return {
                    'id': user['id'],
                    'email': user['email'],
                    'role': user['role']
                }
            return None
    except Exception:
        return None

def get_all_users():
    try:
        with get_db_connection() as conn:
            users = conn.execute('SELECT id, email, role FROM users').fetchall()
            return [
                {
                    'id': user['id'],
                    'email': user['email'],
                    'role': user['role']
                }
                for user in users
            ]
    except Exception:
        return []

def delete_user_by_id(user_id):
    try:
        with get_db_connection() as conn:
            cursor = conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
            conn.commit()
            return cursor.rowcount > 0
    except Exception:
        return False

# JWT functions
def generate_token(user_id):
    try:
        payload = {
            'user_id': user_id,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    except Exception:
        return None

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload.get('user_id')
    except Exception:
        return None

# Input validation
def validate_email(email):
    if not email or not isinstance(email, str):
        return False
    if len(email) > 254:
        return False
    # Basic email regex
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))

def validate_password(password):
    return isinstance(password, str) and len(password) >= 6

# Authentication decorators
def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            auth_header = request.headers.get('Authorization', '')
            
            if not auth_header.startswith('Bearer '):
                return jsonify({'error': 'Unauthorized'}), 401
            
            token = auth_header[7:]  # Remove 'Bearer ' prefix
            
            user_id = verify_token(token)
            if user_id is None:
                return jsonify({'error': 'Unauthorized'}), 401
            
            current_user = get_user_by_id(user_id)
            if current_user is None:
                return jsonify({'error': 'Unauthorized'}), 401
            
            g.current_user = current_user
            return f(*args, **kwargs)
        except Exception:
            return jsonify({'error': 'Unauthorized'}), 401
    
    return decorated

def admin_required(f):
    @wraps(f)
    @auth_required
    def decorated(*args, **kwargs):
        try:
            if not hasattr(g, 'current_user') or g.current_user.get('role') != 'admin':
                return jsonify({'error': 'Forbidden - admin access required'}), 403
            return f(*args, **kwargs)
        except Exception:
            return jsonify({'error': 'Forbidden - admin access required'}), 403
    
    return decorated

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': 'Invalid request format'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not validate_email(email):
            return jsonify({'error': 'Invalid email format'}), 400
        
        if not validate_password(password):
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        if create_user(email, password):
            return jsonify({'message': 'Registration successful'}), 201
        else:
            return jsonify({'error': 'Email already in use or registration failed'}), 400
    
    except Exception:
        return jsonify({'error': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': 'Invalid request format'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        user = verify_user(email, password)
        if user:
            token = generate_token(user['id'])
            if token:
                return jsonify({'token': token}), 200
        
        return jsonify({'error': 'Invalid credentials'}), 401
    
    except Exception:
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/profile', methods=['GET'])
@auth_required
def profile():
    try:
        return jsonify({
            'email': g.current_user['email'],
            'role': g.current_user['role']
        }), 200
    except Exception:
        return jsonify({'error': 'Unauthorized'}), 401

@app.route('/admin/users', methods=['GET'])
@admin_required
def list_users():
    try:
        users = get_all_users()
        return jsonify(users), 200
    except Exception:
        return jsonify({'error': 'Forbidden - admin access required'}), 403

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    try:
        if user_id <= 0:
            return jsonify({'error': 'Invalid user ID'}), 400
        
        if delete_user_by_id(user_id):
            return jsonify({'message': 'User deleted'}), 200
        else:
            return jsonify({'error': 'User not found'}), 404
    except Exception:
        return jsonify({'error': 'Forbidden - admin access required'}), 403

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)