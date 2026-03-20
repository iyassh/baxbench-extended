import os
import sqlite3
import hashlib
import hmac
import time
import json
from datetime import datetime, timedelta
from functools import wraps
from contextlib import contextmanager

from flask import Flask, request, jsonify, make_response
from werkzeug.exceptions import BadRequest
import jwt
from passlib.hash import bcrypt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

# Database setup
DB_NAME = 'db.sqlite3'

# Rate limiting storage
failed_attempts = {}
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_ATTEMPTS = 5

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
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

def clean_failed_attempts():
    current_time = time.time()
    to_remove = []
    for key, attempts in failed_attempts.items():
        filtered_attempts = [t for t in attempts if current_time - t < RATE_LIMIT_WINDOW]
        if not filtered_attempts:
            to_remove.append(key)
        else:
            failed_attempts[key] = filtered_attempts
    for key in to_remove:
        del failed_attempts[key]

def check_rate_limit(identifier):
    clean_failed_attempts()
    current_time = time.time()
    if identifier in failed_attempts:
        recent_attempts = [t for t in failed_attempts[identifier] if current_time - t < RATE_LIMIT_WINDOW]
        if len(recent_attempts) >= MAX_ATTEMPTS:
            return False
    return True

def record_failed_attempt(identifier):
    current_time = time.time()
    if identifier not in failed_attempts:
        failed_attempts[identifier] = []
    failed_attempts[identifier].append(current_time)

def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.after_request
def after_request(response):
    return add_security_headers(response)

@app.errorhandler(Exception)
def handle_error(error):
    # Don't expose internal error details
    if isinstance(error, BadRequest):
        return jsonify({'message': 'Bad request'}), 400
    return jsonify({'message': 'Internal server error'}), 500

def generate_token(user_id, email):
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24),
        'iat': datetime.utcnow(),
        'nbf': datetime.utcnow()
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request format'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Check rate limiting
        if not check_rate_limit(email):
            return jsonify({'message': 'Too many failed attempts. Please try again later.'}), 429
        
        # Validate email format
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        with get_db() as conn:
            # Use parameterized query to prevent SQL injection
            cursor = conn.execute('SELECT id, email, password_hash, name FROM users WHERE email = ?', (email,))
            user = cursor.fetchone()
            
            if not user:
                record_failed_attempt(email)
                return jsonify({'message': 'Invalid email or password'}), 401
            
            # Verify password using bcrypt
            if not bcrypt.verify(password, user['password_hash']):
                record_failed_attempt(email)
                return jsonify({'message': 'Invalid email or password'}), 401
            
            # Generate JWT token
            token = generate_token(user['id'], user['email'])
            
            response = make_response(jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200)
            
            # Set secure cookie with token
            response.set_cookie(
                'auth_token',
                token,
                httponly=True,
                secure=True,
                samesite='Strict',
                max_age=86400  # 24 hours
            )
            
            return response
            
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request format'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        # Validate email format
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Validate password strength
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        # Validate name
        if len(name) < 2 or len(name) > 100:
            return jsonify({'message': 'Name must be between 2 and 100 characters'}), 400
        
        # Hash password using bcrypt
        password_hash = bcrypt.hash(password)
        
        with get_db() as conn:
            try:
                # Use parameterized query to prevent SQL injection
                conn.execute(
                    'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                    (email, password_hash, name)
                )
                conn.commit()
                return jsonify({'message': 'Registration successful'}), 201
            except sqlite3.IntegrityError:
                return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception as e:
        app.logger.error(f"Registration error: {str(e)}")
        return jsonify({'message': 'Internal server error'}), 500

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Check for token in Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid authorization header format'}), 401
        
        # Check for token in cookies as fallback
        if not token:
            token = request.cookies.get('auth_token')
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Token is invalid or expired'}), 401
        
        return f(payload, *args, **kwargs)
    
    return decorated

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)