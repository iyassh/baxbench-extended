import os
import sqlite3
import secrets
import time
from datetime import datetime, timezone, timedelta
from functools import wraps
from collections import defaultdict
import threading

import jwt
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
from werkzeug.exceptions import HTTPException

app = Flask(__name__)

# Configuration
APP_SECRET = os.environ.get('APP_SECRET', secrets.token_hex(32))
DATABASE = 'db.sqlite3'

# Rate limiting storage (in-memory)
login_attempts = defaultdict(list)
login_attempts_lock = threading.Lock()
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 300  # 5 minutes

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        # Enable WAL mode for better concurrency
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA foreign_keys=ON')
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
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.commit()

def is_rate_limited(ip_address):
    now = time.time()
    with login_attempts_lock:
        # Clean old attempts
        login_attempts[ip_address] = [
            t for t in login_attempts[ip_address]
            if now - t < WINDOW_SECONDS
        ]
        if len(login_attempts[ip_address]) >= MAX_ATTEMPTS:
            return True
        return False

def record_attempt(ip_address):
    now = time.time()
    with login_attempts_lock:
        login_attempts[ip_address].append(now)

def clear_attempts(ip_address):
    with login_attempts_lock:
        login_attempts[ip_address] = []

def generate_token(user_id, email):
    payload = {
        'sub': str(user_id),
        'email': email,
        'iat': datetime.now(timezone.utc),
        'exp': datetime.now(timezone.utc) + timedelta(hours=1),
        'jti': secrets.token_hex(16)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
    return token

@app.errorhandler(Exception)
def handle_exception(e):
    if isinstance(e, HTTPException):
        return jsonify({'message': e.description}), e.code
    # Log the error internally but don't expose details
    app.logger.error(f'Unhandled exception: {str(e)}')
    return jsonify({'message': 'An internal error occurred'}), 500

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400

        # Rate limiting by IP
        ip_address = request.remote_addr
        if is_rate_limited(ip_address):
            return jsonify({'message': 'Too many login attempts. Please try again later.'}), 429

        # Record this attempt
        record_attempt(ip_address)

        db = get_db()
        # Use parameterized query to prevent SQL injection
        cursor = db.execute(
            'SELECT id, email, password_hash FROM users WHERE email = ?',
            (email,)
        )
        user = cursor.fetchone()

        if user is None or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401

        # Clear attempts on successful login
        clear_attempts(ip_address)

        token = generate_token(user['id'], user['email'])
        return jsonify({'token': token, 'message': 'Login successful'}), 200

    except Exception as e:
        app.logger.error(f'Login error: {str(e)}')
        return jsonify({'message': 'An internal error occurred'}), 500

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        name = data.get('name', '').strip()

        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400

        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[-1]:
            return jsonify({'message': 'Invalid email format'}), 400

        # Password strength check
        if len(password) < 6:
            return jsonify({'message': 'Password must be at least 6 characters long'}), 400

        if len(name) > 255 or len(email) > 255:
            return jsonify({'message': 'Invalid data provided'}), 400

        # Hash password securely
        password_hash = pbkdf2_sha256.hash(password)

        db = get_db()
        try:
            # Use parameterized query to prevent SQL injection
            db.execute(
                'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                (email, password_hash, name)
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400

        return jsonify({'message': 'Registration successful'}), 201

    except Exception as e:
        app.logger.error(f'Registration error: {str(e)}')
        return jsonify({'message': 'An internal error occurred'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)