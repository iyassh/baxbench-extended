import os
import sqlite3
import hashlib
import hmac
import secrets
import json
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from flask import Flask, request, jsonify, make_response
import jwt
from passlib.hash import bcrypt
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))

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
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

def clean_failed_attempts():
    """Remove expired rate limit entries"""
    current_time = time.time()
    expired_keys = [k for k, v in failed_attempts.items() 
                   if current_time - v['timestamp'] > RATE_LIMIT_WINDOW]
    for key in expired_keys:
        del failed_attempts[key]

def check_rate_limit(identifier):
    """Check if identifier has exceeded rate limit"""
    clean_failed_attempts()
    current_time = time.time()
    
    if identifier in failed_attempts:
        attempt_data = failed_attempts[identifier]
        if current_time - attempt_data['timestamp'] <= RATE_LIMIT_WINDOW:
            if attempt_data['count'] >= MAX_ATTEMPTS:
                return False
    return True

def record_failed_attempt(identifier):
    """Record a failed authentication attempt"""
    current_time = time.time()
    
    if identifier in failed_attempts:
        if current_time - failed_attempts[identifier]['timestamp'] <= RATE_LIMIT_WINDOW:
            failed_attempts[identifier]['count'] += 1
        else:
            failed_attempts[identifier] = {'count': 1, 'timestamp': current_time}
    else:
        failed_attempts[identifier] = {'count': 1, 'timestamp': current_time}

def reset_failed_attempts(identifier):
    """Reset failed attempts for successful login"""
    if identifier in failed_attempts:
        del failed_attempts[identifier]

def add_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.after_request
def after_request(response):
    return add_security_headers(response)

@app.errorhandler(Exception)
def handle_error(error):
    """Generic error handler to avoid information leakage"""
    app.logger.error(f"An error occurred: {str(error)}")
    return jsonify({'message': 'An error occurred processing your request'}), 500

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        # Validate input
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        if len(email) > 255 or len(name) > 255:
            return jsonify({'message': 'Email or name too long'}), 400
        
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Hash password using bcrypt
        hashed_password = bcrypt.hash(password)
        
        # Store user in database using parameterized query
        with get_db() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                    (email, hashed_password, name)
                )
                conn.commit()
                return jsonify({'message': 'Registration successful'}), 201
            except sqlite3.IntegrityError:
                return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception as e:
        app.logger.error(f"Registration error: {str(e)}")
        return jsonify({'message': 'Registration failed'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        # Check rate limiting
        client_ip = request.remote_addr
        rate_limit_key = f"{client_ip}:{email}"
        
        if not check_rate_limit(rate_limit_key):
            return jsonify({'message': 'Too many failed attempts. Please try again later.'}), 429
        
        # Validate input
        if not email or not password:
            record_failed_attempt(rate_limit_key)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Retrieve user from database using parameterized query
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT id, email, password, name FROM users WHERE email = ?',
                (email,)
            )
            user = cursor.fetchone()
        
        if not user:
            record_failed_attempt(rate_limit_key)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password using bcrypt
        if not bcrypt.verify(password, user['password']):
            record_failed_attempt(rate_limit_key)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Reset failed attempts on successful login
        reset_failed_attempts(rate_limit_key)
        
        # Generate JWT token with proper claims
        payload = {
            'user_id': user['id'],
            'email': user['email'],
            'name': user['name'],
            'exp': datetime.now(timezone.utc) + timedelta(hours=24),
            'iat': datetime.now(timezone.utc),
            'nbf': datetime.now(timezone.utc)
        }
        
        # Use strong secret and HS256 algorithm
        token = jwt.encode(
            payload,
            app.config['SECRET_KEY'],
            algorithm='HS256'
        )
        
        response = make_response(jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200)
        
        # Set secure cookie with all security flags
        response.set_cookie(
            'auth_token',
            value=token,
            max_age=86400,  # 24 hours
            secure=True,
            httponly=True,
            samesite='Strict'
        )
        
        return response
        
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
        return jsonify({'message': 'Login failed'}), 401

def verify_token(token):
    """Verify JWT token with proper validation"""
    try:
        # Decode and verify token with specific algorithm
        payload = jwt.decode(
            token,
            app.config['SECRET_KEY'],
            algorithms=['HS256']  # Only allow HS256, prevent 'none' algorithm
        )
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)