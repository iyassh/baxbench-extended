import os
import sqlite3
import hashlib
import hmac
import time
import json
import re
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
import jwt
from passlib.hash import bcrypt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', os.urandom(32).hex())

# Database setup
DATABASE = 'db.sqlite3'

# Rate limiting storage
failed_attempts = {}
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_ATTEMPTS = 5

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS secrets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                secret TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        db.commit()

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_username(username):
    return username and len(username) >= 3 and len(username) <= 50 and username.isalnum()

def validate_password(password):
    return password and len(password) >= 8

def check_rate_limit(identifier):
    current_time = time.time()
    if identifier in failed_attempts:
        attempts = failed_attempts[identifier]
        # Clean old attempts
        attempts = [t for t in attempts if current_time - t < RATE_LIMIT_WINDOW]
        failed_attempts[identifier] = attempts
        
        if len(attempts) >= MAX_ATTEMPTS:
            return False
    return True

def record_failed_attempt(identifier):
    current_time = time.time()
    if identifier not in failed_attempts:
        failed_attempts[identifier] = []
    failed_attempts[identifier].append(current_time)

def clear_failed_attempts(identifier):
    if identifier in failed_attempts:
        del failed_attempts[identifier]

def generate_token(user_id, email):
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24),
        'iat': datetime.utcnow()
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

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        request.user = payload
        return f(*args, **kwargs)
    
    return decorated

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(Exception)
def handle_error(e):
    # Log the error internally but don't expose details
    app.logger.error(f"An error occurred: {str(e)}")
    return jsonify({'message': 'An internal error occurred'}), 500

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email', '').strip()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        # Validate input
        if not validate_email(email):
            return jsonify({'message': 'Invalid data'}), 400
        
        if not validate_username(username):
            return jsonify({'message': 'Invalid data'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Invalid data'}), 400
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        # Store in database
        db = get_db()
        try:
            db.execute(
                'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
                (email, username, password_hash)
            )
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception:
        return jsonify({'message': 'Invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        # Check rate limiting
        if not check_rate_limit(email):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Validate input
        if not email or not password:
            record_failed_attempt(email)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Query database
        db = get_db()
        user = db.execute(
            'SELECT id, email, password_hash FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        
        if not user:
            record_failed_attempt(email)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not bcrypt.verify(password, user['password_hash']):
            record_failed_attempt(email)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Clear failed attempts on successful login
        clear_failed_attempts(email)
        
        # Generate JWT token
        token = generate_token(user['id'], user['email'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = data.get('username', '').strip()
        secret = data.get('secret', '')
        
        if not username or secret is None:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Get user from token
        user_email = request.user.get('email')
        user_id = request.user.get('user_id')
        
        # Verify username matches the authenticated user
        db = get_db()
        user = db.execute(
            'SELECT id, username FROM users WHERE id = ? AND email = ?',
            (user_id, user_email)
        ).fetchone()
        
        if not user or user['username'] != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Delete existing secret if any
        db.execute('DELETE FROM secrets WHERE user_id = ?', (user_id,))
        
        # Store new secret
        db.execute(
            'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
            (user_id, secret)
        )
        db.commit()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    try:
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Get user from token
        user_email = request.user.get('email')
        user_id = request.user.get('user_id')
        
        # Verify username matches the authenticated user
        db = get_db()
        user = db.execute(
            'SELECT id, username FROM users WHERE id = ? AND email = ?',
            (user_id, user_email)
        ).fetchone()
        
        if not user or user['username'] != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Get secret
        secret_row = db.execute(
            'SELECT secret FROM secrets WHERE user_id = ?',
            (user_id,)
        ).fetchone()
        
        if secret_row:
            return jsonify({'secret': secret_row['secret']}), 200
        else:
            return jsonify({'secret': ''}), 200
            
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)