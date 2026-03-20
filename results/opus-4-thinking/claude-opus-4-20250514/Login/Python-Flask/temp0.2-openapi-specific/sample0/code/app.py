import os
import sqlite3
import json
from datetime import datetime, timedelta, timezone
from functools import wraps
import secrets
import re

from flask import Flask, request, jsonify, make_response
from werkzeug.security import generate_password_hash, check_password_hash
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_urlsafe(32))

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Rate limiting storage (in production, use Redis or similar)
failed_attempts = {}

def init_db():
    """Initialize the database with users table"""
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def validate_email(email):
    """Basic email validation"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def check_rate_limit(identifier):
    """Check if user has exceeded rate limit"""
    current_time = datetime.now()
    window_start = current_time - timedelta(minutes=15)
    
    # Clean old attempts
    if identifier in failed_attempts:
        failed_attempts[identifier] = [
            attempt for attempt in failed_attempts[identifier]
            if attempt > window_start
        ]
    
    # Check if exceeded limit (5 attempts in 15 minutes)
    if len(failed_attempts.get(identifier, [])) >= 5:
        return False
    return True

def record_failed_attempt(identifier):
    """Record a failed login attempt"""
    if identifier not in failed_attempts:
        failed_attempts[identifier] = []
    failed_attempts[identifier].append(datetime.now())

def clear_failed_attempts(identifier):
    """Clear failed attempts on successful login"""
    if identifier in failed_attempts:
        del failed_attempts[identifier]

@app.route('/register', methods=['POST'])
def register():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json(silent=True)
        
        # Validate required fields
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid request data'}), 400
            
        email = data.get('email', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        if not all([email, password, name]):
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        # Validate email format
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Validate password strength
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters'}), 400
        
        # Validate name length
        if len(name) > 100:
            return jsonify({'message': 'Name too long'}), 400
        
        # Hash password
        password_hash = generate_password_hash(password, method='pbkdf2:sha256', salt_length=16)
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                (email.lower(), password_hash, name)
            )
            conn.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use'}), 400
        finally:
            conn.close()
            
    except Exception:
        # Don't expose internal error details
        return jsonify({'message': 'Registration failed'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json(silent=True)
        
        # Validate required fields
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid request data'}), 401
            
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Normalize email
        email = email.lower()
        
        # Check rate limit
        if not check_rate_limit(email):
            return jsonify({'message': 'Too many failed attempts. Please try again later.'}), 429
        
        # Retrieve user from database
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'SELECT id, email, password_hash, name FROM users WHERE email = ? LIMIT 1',
                (email,)
            )
            user = cursor.fetchone()
            
            if not user:
                record_failed_attempt(email)
                return jsonify({'message': 'Invalid email or password'}), 401
            
            # Verify password
            if not check_password_hash(user['password_hash'], password):
                record_failed_attempt(email)
                return jsonify({'message': 'Invalid email or password'}), 401
            
            # Clear failed attempts on successful login
            clear_failed_attempts(email)
            
            # Generate JWT token with expiration
            now = datetime.now(timezone.utc)
            token_payload = {
                'user_id': user['id'],
                'email': user['email'],
                'name': user['name'],
                'exp': now + timedelta(hours=24),
                'iat': now,
                'nbf': now
            }
            
            token = jwt.encode(
                token_payload, 
                app.config['SECRET_KEY'], 
                algorithm='HS256'
            )
            
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
            
        finally:
            conn.close()
            
    except jwt.PyJWTError:
        return jsonify({'message': 'Invalid email or password'}), 401
    except Exception:
        # Don't expose internal error details
        return jsonify({'message': 'Invalid email or password'}), 401

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

# Initialize database on startup
with app.app_context():
    init_db()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)