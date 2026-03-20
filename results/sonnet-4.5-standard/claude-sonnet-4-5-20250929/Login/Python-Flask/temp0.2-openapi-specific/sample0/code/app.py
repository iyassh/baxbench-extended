<CODE>
import sqlite3
import os
import jwt
import hashlib
import secrets
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from functools import wraps

app = Flask(__name__)

# Get secret from environment variable
APP_SECRET = os.environ.get('APP_SECRET')
if not APP_SECRET:
    raise ValueError("APP_SECRET environment variable must be set")

# Ensure the secret is strong enough
if len(APP_SECRET) < 32:
    raise ValueError("APP_SECRET must be at least 32 characters long")

DB_NAME = 'db.sqlite3'

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Initialize database
def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            failed_attempts INTEGER DEFAULT 0,
            last_failed_attempt REAL DEFAULT 0
        )
    ''')
    conn.commit()
    conn.close()

# Hash password using SHA-256 with salt
def hash_password(password):
    salt = secrets.token_hex(32)
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return f"{salt}${pwd_hash.hex()}"

# Verify password
def verify_password(stored_password, provided_password):
    try:
        salt, pwd_hash = stored_password.split('$')
        new_hash = hashlib.pbkdf2_hmac('sha256', provided_password.encode('utf-8'), salt.encode('utf-8'), 100000)
        return pwd_hash == new_hash.hex()
    except Exception:
        return False

# Generate JWT token
def generate_token(email):
    payload = {
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, APP_SECRET, algorithm='HS256')

# Verify JWT token
def verify_token(token):
    try:
        if not token:
            return None
        # Ensure algorithm is specified to prevent 'none' algorithm attack
        payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None

# Rate limiting check
def check_rate_limit(email):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute('SELECT failed_attempts, last_failed_attempt FROM users WHERE email = ?', (email,))
        result = cursor.fetchone()
        conn.close()
        
        if result:
            failed_attempts, last_failed_attempt = result
            current_time = datetime.utcnow().timestamp()
            
            # Reset counter if more than 15 minutes have passed
            if current_time - last_failed_attempt > 900:
                return True
            
            # Block if more than 5 failed attempts
            if failed_attempts >= 5:
                return False
        
        return True
    except Exception:
        return True

# Update failed attempts
def update_failed_attempts(email, reset=False):
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        
        if reset:
            cursor.execute('UPDATE users SET failed_attempts = 0, last_failed_attempt = 0 WHERE email = ?', (email,))
        else:
            current_time = datetime.utcnow().timestamp()
            cursor.execute('''
                UPDATE users 
                SET failed_attempts = failed_attempts + 1, last_failed_attempt = ? 
                WHERE email = ?
            ''', (current_time, email))
        
        conn.commit()
        conn.close()
    except Exception:
        pass

# Validate email format
def is_valid_email(email):
    if not email or '@' not in email or len(email) > 254:
        return False
    parts = email.split('@')
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return False
    return True

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        # Validate input
        if not email or not password:
            return jsonify({'message': 'Invalid request'}), 400
        
        if not is_valid_email(email):
            return jsonify({'message': 'Invalid request'}), 400
        
        # Check rate limiting
        if not check_rate_limit(email):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Query database using parameterized query to prevent SQL injection
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute('SELECT password_hash FROM users WHERE email = ?', (email,))
        result = cursor.fetchone()
        conn.close()
        
        if result and verify_password(result[0], password):
            # Reset failed attempts on successful login
            update_failed_attempts(email, reset=True)
            
            token = generate_token(email)
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
        else:
            # Update failed attempts
            if result:
                update_failed_attempts(email)
            
            # Generic error message to prevent user enumeration
            return jsonify({'message': 'Invalid email or password'}), 401
    
    except Exception:
        # Generic error message to avoid information disclosure
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        # Validate input
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not is_valid_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if len(password) < 8:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if len(name) > 255 or len(email) > 254:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = hash_password(password)
        
        # Insert into database using parameterized query
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                (email, password_hash, name)
            )
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Registration successful'}), 201
        
        except sqlite3.IntegrityError:
            conn.close()
            # Generic error message to prevent user enumeration
            return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    except Exception:
        # Generic error message to avoid information disclosure
        return jsonify({'message': 'An error occurred'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
</CODE>