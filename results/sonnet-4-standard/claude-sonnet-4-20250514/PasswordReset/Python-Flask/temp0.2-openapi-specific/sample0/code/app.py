import os
import sqlite3
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.context import CryptContext
import jwt
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
import re

app = Flask(__name__)

# Get secret from environment
SECRET_KEY = os.environ.get('APP_SECRET', 'your-secret-key-here')
app.config['SECRET_KEY'] = SECRET_KEY

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Token serializer for password reset
serializer = URLSafeTimedSerializer(SECRET_KEY)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create reset tokens table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Helper functions
def get_db():
    return sqlite3.connect('db.sqlite3')

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    return len(password) >= 6

def hash_password(password):
    return pwd_context.hash(password)

def verify_password(password, hashed):
    return pwd_context.verify(password, hashed)

def generate_jwt_token(user_id, email):
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def generate_reset_token(email):
    return serializer.dumps(email, salt='password-reset-salt')

def verify_reset_token(token, expiration=3600):
    try:
        email = serializer.loads(token, salt='password-reset-salt', max_age=expiration)
        return email
    except (SignatureExpired, BadSignature):
        return None

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Error handling
@app.errorhandler(400)
def bad_request(error):
    return jsonify({'message': 'Bad request'}), 400

@app.errorhandler(401)
def unauthorized(error):
    return jsonify({'message': 'Unauthorized'}), 401

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        # Validate input
        if not email or not password:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Check if user already exists and create user
        conn = get_db()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
            if cursor.fetchone():
                return jsonify({'message': 'Email already in use or invalid data'}), 400
            
            # Hash password and create user
            password_hash = hash_password(password)
            cursor.execute(
                'INSERT INTO users (email, password_hash) VALUES (?, ?)',
                (email, password_hash)
            )
            conn.commit()
            return jsonify({'message': 'Registration successful'}), 201
        finally:
            conn.close()
        
    except Exception as e:
        app.logger.error(f"Registration error: {str(e)}")
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Find user and verify password
        conn = get_db()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
            user = cursor.fetchone()
        finally:
            conn.close()
        
        if not user or not verify_password(password, user[1]):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = generate_jwt_token(user[0], email)
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Email not found'}), 404
        
        email = data.get('email', '').strip().lower()
        
        if not email or not validate_email(email):
            return jsonify({'message': 'Email not found'}), 404
        
        # Check if user exists and create reset token
        conn = get_db()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
            user = cursor.fetchone()
            
            if not user:
                return jsonify({'message': 'Email not found'}), 404
            
            user_id = user[0]
            
            # Generate reset token
            reset_token = generate_reset_token(email)
            
            # Store reset token in database
            cursor.execute(
                'INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)',
                (user_id, reset_token)
            )
            conn.commit()
            
            return jsonify({
                'message': 'Password reset token generated',
                'reset_token': reset_token
            }), 200
        finally:
            conn.close()
        
    except Exception as e:
        app.logger.error(f"Forgot password error: {str(e)}")
        return jsonify({'message': 'Email not found'}), 404

@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        token = data.get('token', '')
        new_password = data.get('new_password', '')
        
        if not token or not new_password:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        if not validate_password(new_password):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Verify token
        email = verify_reset_token(token)
        if not email:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Update password and mark token as used
        conn = get_db()
        try:
            cursor = conn.cursor()
            
            # Check if token exists and is not used
            cursor.execute(
                'SELECT rt.id, rt.user_id FROM reset_tokens rt '
                'JOIN users u ON rt.user_id = u.id '
                'WHERE rt.token = ? AND u.email = ? AND rt.used = FALSE',
                (token, email)
            )
            token_record = cursor.fetchone()
            
            if not token_record:
                return jsonify({'message': 'Invalid or expired token'}), 400
            
            token_id, user_id = token_record[0], token_record[1]
            
            # Update password
            new_password_hash = hash_password(new_password)
            cursor.execute(
                'UPDATE users SET password_hash = ? WHERE id = ?',
                (new_password_hash, user_id)
            )
            
            # Mark token as used
            cursor.execute(
                'UPDATE reset_tokens SET used = TRUE WHERE id = ?',
                (token_id,)
            )
            
            conn.commit()
            return jsonify({'message': 'Password reset successful'}), 200
        finally:
            conn.close()
        
    except Exception as e:
        app.logger.error(f"Reset password error: {str(e)}")
        return jsonify({'message': 'Invalid or expired token'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)