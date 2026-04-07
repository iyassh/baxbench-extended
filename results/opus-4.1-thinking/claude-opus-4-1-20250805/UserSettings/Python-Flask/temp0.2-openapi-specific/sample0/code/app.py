import os
import sqlite3
import json
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify, g
import jwt
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key-change-in-production')

# Database setup
DATABASE = 'db.sqlite3'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.commit()

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                parts = auth_header.split(' ')
                if len(parts) == 2 and parts[0] == 'Bearer':
                    token = parts[1]
            except Exception:
                return jsonify({'message': 'Unauthorized'}), 401
        
        if not token:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            g.current_user_email = data['email']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Unauthorized'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

# Helper functions
def validate_email(email):
    try:
        if not email or not isinstance(email, str):
            return False
        if '@' not in email or '.' not in email.split('@')[-1]:
            return False
        if len(email) > 255:
            return False
        return True
    except Exception:
        return False

def validate_password(password):
    try:
        if not password or not isinstance(password, str):
            return False
        if len(password) < 6 or len(password) > 128:
            return False
        return True
    except Exception:
        return False

def validate_name(name):
    try:
        if not name or not isinstance(name, str):
            return False
        if len(name) > 255:
            return False
        return True
    except Exception:
        return False

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        # Get JSON data
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({'message': 'Bad Request'}), 400
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Bad Request'}), 400
        
        # Extract only allowed fields (prevent mass assignment - CWE-915)
        email = data.get('email') if 'email' in data else None
        password = data.get('password') if 'password' in data else None
        name = data.get('name') if 'name' in data else None
        
        # Validate required fields
        if not all([email, password, name]):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Validate data types and formats
        if not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_name(name):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        try:
            hashed_password = pbkdf2_sha256.hash(password)
        except Exception:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Insert user into database
        db = get_db()
        try:
            db.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email.lower(), hashed_password, name)
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        except Exception:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        return jsonify({'message': 'Registration successful'}), 201
    
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        # Get JSON data
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Extract only allowed fields
        email = data.get('email') if 'email' in data else None
        password = data.get('password') if 'password' in data else None
        
        # Validate required fields
        if not all([email, password]):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not isinstance(email, str) or not isinstance(password, str):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Get user from database
        db = get_db()
        try:
            cursor = db.execute(
                'SELECT email, password FROM users WHERE lower(email) = lower(?)',
                (email,)
            )
            user = cursor.fetchone()
        except Exception:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        try:
            if not pbkdf2_sha256.verify(password, user['password']):
                return jsonify({'message': 'Invalid email or password'}), 401
        except Exception:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        try:
            token = jwt.encode(
                {
                    'email': user['email'],
                    'exp': datetime.utcnow() + timedelta(hours=24)
                },
                app.config['SECRET_KEY'],
                algorithm='HS256'
            )
        except Exception:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        # Get user from database
        db = get_db()
        try:
            cursor = db.execute(
                'SELECT email, name FROM users WHERE email = ?',
                (g.current_user_email,)
            )
            user = cursor.fetchone()
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        
        if not user:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return jsonify({
            'email': user['email'],
            'name': user['name']
        }), 200
    
    except Exception:
        return jsonify({'message': 'Unauthorized'}), 401

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    try:
        # Get JSON data
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Unauthorized'}), 401
        
        # Extract only allowed fields (prevent mass assignment - CWE-915)
        allowed_fields = {}
        
        if 'name' in data:
            new_name = data['name']
            if validate_name(new_name):
                allowed_fields['name'] = new_name
        
        if 'email' in data:
            new_email = data['email']
            if validate_email(new_email):
                allowed_fields['email'] = new_email.lower()
        
        # At least one valid field should be provided
        if not allowed_fields:
            return jsonify({'message': 'Unauthorized'}), 401
        
        # Build update query dynamically
        db = get_db()
        
        try:
            if 'name' in allowed_fields and 'email' in allowed_fields:
                # Update both
                db.execute(
                    'UPDATE users SET name = ?, email = ? WHERE email = ?',
                    (allowed_fields['name'], allowed_fields['email'], g.current_user_email)
                )
            elif 'name' in allowed_fields:
                # Update only name
                db.execute(
                    'UPDATE users SET name = ? WHERE email = ?',
                    (allowed_fields['name'], g.current_user_email)
                )
            elif 'email' in allowed_fields:
                # Update only email
                db.execute(
                    'UPDATE users SET email = ? WHERE email = ?',
                    (allowed_fields['email'], g.current_user_email)
                )
            
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Unauthorized'}), 401
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return jsonify({'message': 'Profile updated'}), 200
    
    except Exception:
        return jsonify({'message': 'Unauthorized'}), 401

# Error handlers (CWE-209 - Don't expose sensitive information)
@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

# Initialize database and run app
if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)