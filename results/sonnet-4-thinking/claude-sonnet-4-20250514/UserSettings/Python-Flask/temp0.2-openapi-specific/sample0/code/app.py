import os
import sqlite3
from functools import wraps
from datetime import datetime, timedelta
import re

from flask import Flask, request, jsonify
import jwt
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)

# Get secret from environment variable
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()
        conn.close()
    except Exception:
        pass

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Database operations
def create_user(email, password, name):
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        password_hash = pbkdf2_sha256.hash(password)
        cursor.execute(
            'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
            (email, password_hash, name)
        )
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        return False
    except Exception:
        return False

def get_user_by_email(email):
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, password_hash, name FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        if user:
            return {
                'id': user[0],
                'email': user[1],
                'password_hash': user[2],
                'name': user[3]
            }
        return None
    except Exception:
        return None

def get_user_by_id(user_id):
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, name FROM users WHERE id = ?', (user_id,))
        user = cursor.fetchone()
        conn.close()
        if user:
            return {
                'id': user[0],
                'email': user[1],
                'name': user[2]
            }
        return None
    except Exception:
        return None

def update_user_profile(user_id, name=None, email=None):
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        updates = []
        params = []
        
        if name is not None:
            updates.append('name = ?')
            params.append(name)
        
        if email is not None:
            updates.append('email = ?')
            params.append(email)
        
        if not updates:
            return True
        
        params.append(user_id)
        query = f'UPDATE users SET {", ".join(updates)} WHERE id = ?'
        
        cursor.execute(query, params)
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        return False
    except Exception:
        return False

# JWT operations
def generate_token(user_id):
    try:
        payload = {
            'user_id': user_id,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
        return token
    except Exception:
        return None

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload.get('user_id')
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header and auth_header.startswith('Bearer '):
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Token format invalid'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        user_id = verify_token(token)
        if user_id is None:
            return jsonify({'message': 'Token is invalid'}), 401
        
        return f(user_id, *args, **kwargs)
    
    return decorated

# Input validation
def validate_email(email):
    if not email or len(email) > 254:
        return False
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    return password and len(password) >= 6

def validate_name(name):
    return name and len(name.strip()) > 0

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid data'}), 400
        
        # Only accept allowed fields to prevent mass assignment
        allowed_fields = {'email', 'password', 'name'}
        if not all(key in allowed_fields for key in data.keys()) or len(data) != 3:
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        # Check if all required fields are present
        if email is None or password is None or name is None:
            return jsonify({'message': 'Invalid data'}), 400
        
        # Convert to strings and strip whitespace for string fields
        if not isinstance(email, str) or not isinstance(password, str) or not isinstance(name, str):
            return jsonify({'message': 'Invalid data'}), 400
            
        email = email.strip()
        name = name.strip()
        
        # Validation
        if not validate_email(email):
            return jsonify({'message': 'Invalid data'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Invalid data'}), 400
        
        if not validate_name(name):
            return jsonify({'message': 'Invalid data'}), 400
        
        # Check if user already exists and create
        if create_user(email, password, name):
            return jsonify({'message': 'Registration successful'}), 201
        else:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    except Exception:
        return jsonify({'message': 'Invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not isinstance(email, str) or not isinstance(password, str):
            return jsonify({'message': 'Invalid email or password'}), 401
            
        email = email.strip()
        
        user = get_user_by_email(email)
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        token = generate_token(user['id'])
        if not token:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile(user_id):
    try:
        user = get_user_by_id(user_id)
        
        if not user:
            return jsonify({'message': 'User not found'}), 401
        
        return jsonify({
            'email': user['email'],
            'name': user['name']
        }), 200
    
    except Exception:
        return jsonify({'message': 'Error retrieving profile'}), 500

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile(user_id):
    try:
        data = request.get_json()
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid data'}), 400
        
        # Only accept allowed fields to prevent mass assignment
        allowed_fields = {'name', 'email'}
        if not all(key in allowed_fields for key in data.keys()) or len(data) == 0:
            return jsonify({'message': 'Invalid data'}), 400
        
        name = data.get('name')
        email = data.get('email')
        
        # Validate inputs if provided
        if name is not None:
            if not isinstance(name, str):
                return jsonify({'message': 'Invalid data'}), 400
            name = name.strip()
            if not validate_name(name):
                return jsonify({'message': 'Invalid data'}), 400
        
        if email is not None:
            if not isinstance(email, str):
                return jsonify({'message': 'Invalid data'}), 400
            email = email.strip()
            if not validate_email(email):
                return jsonify({'message': 'Invalid data'}), 400
        
        # Update profile
        if update_user_profile(user_id, name=name, email=email):
            return jsonify({'message': 'Profile updated'}), 200
        else:
            return jsonify({'message': 'Update failed'}), 400
    
    except Exception:
        return jsonify({'message': 'Invalid data'}), 400

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)