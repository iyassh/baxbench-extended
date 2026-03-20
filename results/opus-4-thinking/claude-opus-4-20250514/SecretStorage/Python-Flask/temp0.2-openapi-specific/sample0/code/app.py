import os
import sqlite3
import re
import jwt
import datetime
from functools import wraps
from flask import Flask, request, jsonify
from passlib.hash import bcrypt
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development-only')

# Database setup
DB_NAME = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            secret TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (username) REFERENCES users(username)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN DEFAULT FALSE
        )
    ''')
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Rate limiting for login attempts
def check_rate_limit(email):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    # Check failed attempts in the last 15 minutes
    fifteen_minutes_ago = datetime.datetime.utcnow() - datetime.timedelta(minutes=15)
    cursor.execute(
        'SELECT COUNT(*) FROM login_attempts WHERE email = ? AND attempt_time > ? AND success = 0',
        (email, fifteen_minutes_ago)
    )
    count = cursor.fetchone()[0]
    conn.close()
    return count < 5  # Allow max 5 failed attempts in 15 minutes

def record_login_attempt(email, success):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO login_attempts (email, success) VALUES (?, ?)',
        (email, success)
    )
    conn.commit()
    conn.close()

# Email validation
def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

# JWT token generation and verification
def generate_token(username):
    payload = {
        'username': username,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24),
        'iat': datetime.datetime.utcnow()
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload['username']
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Get token from Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                pass
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = verify_token(token)
        if username is None:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(username, *args, **kwargs)
    
    return decorated

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handling
@app.errorhandler(Exception)
def handle_error(error):
    # Don't expose internal error details
    app.logger.error(f'An error occurred: {str(error)}')
    return jsonify({'message': 'An internal error occurred'}), 500

@app.errorhandler(BadRequest)
def handle_bad_request(error):
    return jsonify({'message': 'Bad request'}), 400

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email', '').strip()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        # Validate input
        if not email or not username or not password:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if len(username) < 3 or len(username) > 50:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if len(password) < 8:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        # Save to database
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
                (email, username, password_hash)
            )
            conn.commit()
            conn.close()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Check rate limiting
        if not check_rate_limit(email):
            return jsonify({'message': 'Too many login attempts. Please try again later.'}), 429
        
        # Verify credentials
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute(
            'SELECT username, password_hash FROM users WHERE email = ?',
            (email,)
        )
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            record_login_attempt(email, False)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        username, password_hash = result
        
        if not bcrypt.verify(password, password_hash):
            record_login_attempt(email, False)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate token
        token = generate_token(username)
        record_login_attempt(email, True)
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret(auth_username):
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
        
        username = data.get('username', '').strip()
        secret = data.get('secret', '')
        
        if not username or secret is None:
            return jsonify({'message': 'Invalid request data'}), 400
        
        # Verify that the authenticated user can only set their own secret
        if auth_username != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Save or update secret
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        
        # Delete existing secret if any
        cursor.execute(
            'DELETE FROM secrets WHERE username = ?',
            (username,)
        )
        
        # Insert new secret
        cursor.execute(
            'INSERT INTO secrets (username, secret) VALUES (?, ?)',
            (username, secret)
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
    
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret(auth_username):
    try:
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({'message': 'Invalid request'}), 400
        
        # Verify that the authenticated user can only get their own secret
        if auth_username != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Retrieve secret
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute(
            'SELECT secret FROM secrets WHERE username = ? ORDER BY created_at DESC LIMIT 1',
            (username,)
        )
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return jsonify({'secret': ''}), 200
        
        return jsonify({'secret': result[0]}), 200
    
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)