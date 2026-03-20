import sqlite3
import os
import hashlib
import hmac
import time
import json
import re
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)

# Security configuration
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key-change-in-production')
JWT_SECRET = app.config['SECRET_KEY']
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24

# Rate limiting storage
failed_attempts = {}
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_ATTEMPTS = 5

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

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS secrets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                secret_data TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        conn.commit()

@app.before_first_request
def create_tables():
    init_db()

@app.teardown_appcontext
def close_db_connection(exception):
    close_db(exception)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Rate limiting decorator
def rate_limit(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)
        current_time = time.time()
        
        # Clean old entries
        for ip in list(failed_attempts.keys()):
            failed_attempts[ip] = [attempt for attempt in failed_attempts[ip] 
                                 if current_time - attempt < RATE_LIMIT_WINDOW]
            if not failed_attempts[ip]:
                del failed_attempts[ip]
        
        # Check rate limit
        if client_ip in failed_attempts and len(failed_attempts[client_ip]) >= MAX_ATTEMPTS:
            return jsonify({'message': 'Too many failed attempts. Please try again later.'}), 429
        
        return f(*args, **kwargs)
    return decorated_function

def record_failed_attempt():
    client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)
    current_time = time.time()
    
    if client_ip not in failed_attempts:
        failed_attempts[client_ip] = []
    failed_attempts[client_ip].append(current_time)

# Input validation functions
def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_username(username):
    return len(username) >= 3 and len(username) <= 50 and username.isalnum()

def validate_password(password):
    return len(password) >= 8

# JWT token functions
def generate_token(user_id, username):
    payload = {
        'user_id': user_id,
        'username': username,
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(token):
    try:
        # Explicitly specify allowed algorithms to prevent 'none' algorithm attack
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        payload = verify_token(token)
        if payload is None:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        g.current_user = payload
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
@rate_limit
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email', '').strip().lower()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        # Validate input
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        if not validate_username(username):
            return jsonify({'message': 'Username must be 3-50 alphanumeric characters'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Password must be at least 8 characters'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        db = get_db()
        try:
            # Check if email or username already exists
            existing_user = db.execute(
                'SELECT id FROM users WHERE email = ? OR username = ?',
                (email, username)
            ).fetchone()
            
            if existing_user:
                record_failed_attempt()
                return jsonify({'message': 'Email already in use or invalid data'}), 400
            
            # Insert new user
            db.execute(
                'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
                (email, username, password_hash)
            )
            db.commit()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            record_failed_attempt()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
    except Exception:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/login', methods=['POST'])
@rate_limit
def login():
    try:
        data = request.get_json()
        if not data:
            record_failed_attempt()
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            record_failed_attempt()
            return jsonify({'message': 'Invalid email or password'}), 401
        
        db = get_db()
        user = db.execute(
            'SELECT id, username, password_hash FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            record_failed_attempt()
            return jsonify({'message': 'Invalid email or password'}), 401
        
        token = generate_token(user['id'], user['username'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        username = data.get('username', '').strip()
        secret = data.get('secret', '')
        
        if not username or not secret:
            return jsonify({'message': 'Username and secret are required'}), 400
        
        # Verify that the username matches the authenticated user
        if username != g.current_user['username']:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        db = get_db()
        user_id = g.current_user['user_id']
        
        # Check if secret already exists for this user
        existing_secret = db.execute(
            'SELECT id FROM secrets WHERE user_id = ?',
            (user_id,)
        ).fetchone()
        
        if existing_secret:
            # Update existing secret
            db.execute(
                'UPDATE secrets SET secret_data = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                (secret, user_id)
            )
        else:
            # Insert new secret
            db.execute(
                'INSERT INTO secrets (user_id, secret_data) VALUES (?, ?)',
                (user_id, secret)
            )
        
        db.commit()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
        
    except Exception:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    try:
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({'message': 'Username is required'}), 400
        
        # Verify that the username matches the authenticated user
        if username != g.current_user['username']:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        db = get_db()
        user_id = g.current_user['user_id']
        
        secret_row = db.execute(
            'SELECT secret_data FROM secrets WHERE user_id = ?',
            (user_id,)
        ).fetchone()
        
        if not secret_row:
            return jsonify({'message': 'No secret found'}), 404
        
        return jsonify({'secret': secret_row['secret_data']}), 200
        
    except Exception:
        return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)