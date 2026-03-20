import os
import sqlite3
import hashlib
import hmac
import time
import json
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', os.urandom(32).hex())

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Rate limiting
failed_attempts = {}
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_ATTEMPTS = 5

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

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
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
            user_id INTEGER NOT NULL,
            secret TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect('db.sqlite3')
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(error):
    db = g.pop('db', None)
    if db is not None:
        db.close()

# JWT token handling
def generate_token(user_id, username):
    payload = {
        'user_id': user_id,
        'username': username,
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

def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        token = auth_header.split(' ')[1]
        payload = verify_token(token)
        
        if not payload:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        g.current_user = payload
        return f(*args, **kwargs)
    return decorated_function

# Error handling
@app.errorhandler(Exception)
def handle_error(error):
    app.logger.error(f"Unhandled exception: {str(error)}")
    return jsonify({'message': 'An error occurred'}), 500

@app.errorhandler(400)
def bad_request(error):
    return jsonify({'message': 'Bad request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Not found'}), 404

# Routes
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
        if not email or not username or not password:
            return jsonify({'message': 'Email, username, and password are required'}), 400
        
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        # Insert user
        db = get_db()
        cursor = db.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
                (email, username, password_hash)
            )
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
    except Exception as e:
        app.logger.error(f"Registration error: {str(e)}")
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Check rate limit
        if not check_rate_limit(email):
            return jsonify({'message': 'Too many failed attempts. Please try again later.'}), 429
        
        # Get user
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id, username, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user or not bcrypt.verify(password, user['password_hash']):
            record_failed_attempt(email)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate token
        token = generate_token(user['id'], user['username'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/set_secret', methods=['POST'])
@require_auth
def set_secret():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        username = data.get('username', '').strip()
        secret = data.get('secret', '')
        
        if not username or not secret:
            return jsonify({'message': 'Username and secret are required'}), 400
        
        # Verify authorization - user can only set their own secret
        if g.current_user['username'] != username:
            return jsonify({'message': 'Unauthorized'}), 403
        
        # Store secret
        db = get_db()
        cursor = db.cursor()
        
        # Delete existing secret if any
        cursor.execute('DELETE FROM secrets WHERE user_id = ?', (g.current_user['user_id'],))
        
        # Insert new secret
        cursor.execute(
            'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
            (g.current_user['user_id'], secret)
        )
        db.commit()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
        
    except Exception as e:
        app.logger.error(f"Set secret error: {str(e)}")
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/get_secret', methods=['GET'])
@require_auth
def get_secret():
    try:
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({'message': 'Username is required'}), 400
        
        # Verify authorization - user can only get their own secret
        if g.current_user['username'] != username:
            return jsonify({'message': 'Unauthorized'}), 403
        
        # Get secret
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            'SELECT secret FROM secrets WHERE user_id = ?',
            (g.current_user['user_id'],)
        )
        result = cursor.fetchone()
        
        if not result:
            return jsonify({'message': 'No secret found'}), 404
        
        return jsonify({'secret': result['secret']}), 200
        
    except Exception as e:
        app.logger.error(f"Get secret error: {str(e)}")
        return jsonify({'message': 'An error occurred'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)