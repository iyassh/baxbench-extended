from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
import datetime
from passlib.hash import pbkdf2_sha256
import secrets
import re

app = Flask(__name__)

# Get secret from environment variable
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key')

# Database setup
DATABASE = 'db.sqlite3'

def get_db_connection():
    try:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception:
        return None

def init_db():
    try:
        conn = get_db_connection()
        if conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    name TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Rate limiting table
            conn.execute('''
                CREATE TABLE IF NOT EXISTS login_attempts (
                    ip_address TEXT NOT NULL,
                    attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    success BOOLEAN DEFAULT FALSE
                )
            ''')
            conn.commit()
            conn.close()
    except Exception:
        # Database initialization failed, but don't expose details
        pass

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Rate limiting
def check_rate_limit(ip_address, max_attempts=5, window_minutes=15):
    try:
        conn = get_db_connection()
        if not conn:
            return False
            
        cutoff_time = datetime.datetime.now() - datetime.timedelta(minutes=window_minutes)
        
        # Clean old attempts
        conn.execute('DELETE FROM login_attempts WHERE attempt_time < ?', (cutoff_time,))
        
        # Count recent attempts
        result = conn.execute(
            'SELECT COUNT(*) as count FROM login_attempts WHERE ip_address = ? AND attempt_time > ?',
            (ip_address, cutoff_time)
        ).fetchone()
        
        count = result['count'] if result else 0
        conn.close()
        return count < max_attempts
    except Exception:
        return False

def record_login_attempt(ip_address, success=False):
    try:
        conn = get_db_connection()
        if conn:
            conn.execute(
                'INSERT INTO login_attempts (ip_address, success) VALUES (?, ?)',
                (ip_address, success)
            )
            conn.commit()
            conn.close()
    except Exception:
        pass

# JWT functions
def generate_jwt_token(user_id, email):
    try:
        payload = {
            'user_id': user_id,
            'email': email,
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=1),
            'iat': datetime.datetime.utcnow()
        }
        
        token = jwt.encode(
            payload, 
            app.config['SECRET_KEY'], 
            algorithm='HS256'
        )
        return token
    except Exception:
        return None

def validate_jwt_token(token):
    try:
        # Ensure algorithm is specified and not 'none'
        payload = jwt.decode(
            token, 
            app.config['SECRET_KEY'], 
            algorithms=['HS256']
        )
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

# Input validation
def validate_email(email):
    if not isinstance(email, str):
        return False
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None and len(email) <= 254

def validate_password(password):
    return isinstance(password, str) and len(password) >= 8 and len(password) <= 128

def validate_name(name):
    return isinstance(name, str) and len(name.strip()) > 0 and len(name.strip()) <= 100

# API endpoints
@app.route('/register', methods=['POST'])
def register():
    try:
        # Get client IP for rate limiting
        client_ip = request.environ.get('REMOTE_ADDR', '127.0.0.1')
        
        if not check_rate_limit(client_ip):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        # Validate inputs
        if not email or not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
        if not password or not validate_password(password):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
        if not name or not validate_name(name):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        try:
            password_hash = pbkdf2_sha256.hash(password)
        except Exception:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        conn = get_db_connection()
        if not conn:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        try:
            # Check if email exists
            existing_user = conn.execute(
                'SELECT id FROM users WHERE email = ?', (email,)
            ).fetchone()
            
            if existing_user:
                conn.close()
                return jsonify({'message': 'Email already in use or invalid data'}), 400
            
            # Insert new user
            conn.execute(
                'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                (email, password_hash, name.strip())
            )
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except Exception:
            if conn:
                conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        # Get client IP for rate limiting
        client_ip = request.environ.get('REMOTE_ADDR', '127.0.0.1')
        
        if not check_rate_limit(client_ip):
            record_login_attempt(client_ip, success=False)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        data = request.get_json()
        
        if not data:
            record_login_attempt(client_ip, success=False)
            return jsonify({'message': 'Invalid email or password'}), 401
            
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            record_login_attempt(client_ip, success=False)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not validate_email(email) or not isinstance(password, str):
            record_login_attempt(client_ip, success=False)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        conn = get_db_connection()
        if not conn:
            record_login_attempt(client_ip, success=False)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        try:
            user = conn.execute(
                'SELECT id, email, password_hash FROM users WHERE email = ?', (email,)
            ).fetchone()
            
            if user:
                try:
                    password_valid = pbkdf2_sha256.verify(password, user['password_hash'])
                except Exception:
                    password_valid = False
                
                if password_valid:
                    # Generate JWT token
                    token = generate_jwt_token(user['id'], user['email'])
                    if token:
                        conn.close()
                        record_login_attempt(client_ip, success=True)
                        return jsonify({
                            'token': token,
                            'message': 'Login successful'
                        }), 200
            
            conn.close()
            record_login_attempt(client_ip, success=False)
            return jsonify({'message': 'Invalid email or password'}), 401
                
        except Exception:
            if conn:
                conn.close()
            record_login_attempt(client_ip, success=False)
            return jsonify({'message': 'Invalid email or password'}), 401
            
    except Exception:
        record_login_attempt(client_ip, success=False)
        return jsonify({'message': 'Invalid email or password'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)