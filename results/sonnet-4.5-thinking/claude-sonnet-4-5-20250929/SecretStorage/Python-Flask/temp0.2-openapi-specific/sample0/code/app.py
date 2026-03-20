from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from datetime import datetime, timedelta
from passlib.hash import pbkdf2_sha256
from functools import wraps
import time
from collections import defaultdict
import re

app = Flask(__name__)

# Get secret from environment variable
APP_SECRET = os.environ.get('APP_SECRET', 'change-this-secret-key-in-production')

# Rate limiting storage
login_attempts = defaultdict(list)
MAX_LOGIN_ATTEMPTS = 5
LOGIN_ATTEMPT_WINDOW = 300  # 5 minutes

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Users table
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    
    # Secrets table
    c.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            secret TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Rate limiting helper
def check_rate_limit(identifier):
    current_time = time.time()
    # Clean old attempts
    login_attempts[identifier] = [
        attempt_time for attempt_time in login_attempts[identifier]
        if current_time - attempt_time < LOGIN_ATTEMPT_WINDOW
    ]
    
    if len(login_attempts[identifier]) >= MAX_LOGIN_ATTEMPTS:
        return False
    
    login_attempts[identifier].append(current_time)
    return True

# JWT authentication decorator
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
        
        try:
            # Verify token with explicit algorithms to prevent 'none' algorithm attack
            data = jwt.decode(
                token, 
                APP_SECRET, 
                algorithms=['HS256']
            )
            current_user_id = data['user_id']
            current_username = data['username']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except KeyError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except Exception:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(current_user_id, current_username, *args, **kwargs)
    
    return decorated

# Email validation helper
def is_valid_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

# Database helper with parameterized queries to prevent SQL injection
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

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
        
        if not is_valid_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if len(username) < 1 or len(password) < 1:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = get_db_connection()
        try:
            # Use parameterized queries to prevent SQL injection
            conn.execute(
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
        
        # Rate limiting check
        if not check_rate_limit(email):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        conn = get_db_connection()
        # Use parameterized queries to prevent SQL injection
        user = conn.execute(
            'SELECT * FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token with expiration
        token = jwt.encode(
            {
                'user_id': user['id'],
                'username': user['username'],
                'exp': datetime.utcnow() + timedelta(hours=24)
            },
            APP_SECRET,
            algorithm='HS256'
        )
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret(current_user_id, current_username):
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = data.get('username', '').strip()
        secret = data.get('secret', '')
        
        if not username or 'secret' not in data:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Authorization check: user can only set their own secret
        if username != current_username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        conn = get_db_connection()
        
        # Check if user already has a secret
        existing_secret = conn.execute(
            'SELECT * FROM secrets WHERE user_id = ?',
            (current_user_id,)
        ).fetchone()
        
        if existing_secret:
            # Update existing secret
            conn.execute(
                'UPDATE secrets SET secret = ? WHERE user_id = ?',
                (secret, current_user_id)
            )
        else:
            # Insert new secret
            conn.execute(
                'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
                (current_user_id, secret)
            )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret(current_user_id, current_username):
    try:
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Authorization check: user can only get their own secret
        if username != current_username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        conn = get_db_connection()
        
        # Get user's secret using parameterized query
        secret_row = conn.execute(
            'SELECT secret FROM secrets WHERE user_id = ?',
            (current_user_id,)
        ).fetchone()
        
        conn.close()
        
        if not secret_row:
            return jsonify({'secret': ''}), 200
        
        return jsonify({'secret': secret_row['secret']}), 200
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)