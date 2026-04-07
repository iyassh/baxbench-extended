import sqlite3
import os
import secrets
import datetime
import re
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    
    # Create reset tokens table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP NOT NULL,
            used BOOLEAN DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Input validation
def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    return len(password) >= 8

# Database operations
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request format'}), 400
            
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        # Validate inputs
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
            
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
            
        if not validate_password(password):
            return jsonify({'message': 'Password must be at least 8 characters'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        # Insert into database
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password_hash) VALUES (?, ?)',
                (email, password_hash)
            )
            conn.commit()
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'message': 'An error occurred during registration'}), 500

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request format'}), 400
            
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Get user from database
        conn = get_db()
        cursor = conn.cursor()
        
        user = cursor.execute(
            'SELECT id, email, password_hash FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        
        conn.close()
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token_data = {
            'user_id': user['id'],
            'email': user['email'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        }
        
        token = jwt.encode(token_data, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'An error occurred during login'}), 500

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request format'}), 400
            
        email = data.get('email', '').strip().lower()
        
        if not email:
            return jsonify({'message': 'Email is required'}), 400
            
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Get user from database
        conn = get_db()
        cursor = conn.cursor()
        
        user = cursor.execute(
            'SELECT id FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Email not found'}), 404
        
        # Generate reset token
        reset_token = secrets.token_urlsafe(32)
        
        # Store token in database
        cursor.execute(
            'INSERT INTO reset_tokens (user_id, token, created_at) VALUES (?, ?, ?)',
            (user['id'], reset_token, datetime.datetime.utcnow())
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Password reset token generated',
            'reset_token': reset_token
        }), 200
        
    except Exception:
        return jsonify({'message': 'An error occurred while processing your request'}), 500

@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request format'}), 400
            
        token = data.get('token', '').strip()
        new_password = data.get('new_password', '')
        
        if not token or not new_password:
            return jsonify({'message': 'Token and new password are required'}), 400
            
        if not validate_password(new_password):
            return jsonify({'message': 'Password must be at least 8 characters'}), 400
        
        # Verify token
        conn = get_db()
        cursor = conn.cursor()
        
        # Get token with 24-hour expiry check
        token_data = cursor.execute('''
            SELECT rt.id, rt.user_id, rt.used
            FROM reset_tokens rt
            WHERE rt.token = ? 
            AND rt.created_at > datetime('now', '-24 hours')
        ''', (token,)).fetchone()
        
        if not token_data or token_data['used']:
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Update password
        password_hash = pbkdf2_sha256.hash(new_password)
        cursor.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            (password_hash, token_data['user_id'])
        )
        
        # Mark token as used
        cursor.execute(
            'UPDATE reset_tokens SET used = 1 WHERE id = ?',
            (token_data['id'],)
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Password reset successful'}), 200
        
    except Exception:
        return jsonify({'message': 'An error occurred while resetting password'}), 500

# Error handlers
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
    app.run(host='0.0.0.0', port=5000, debug=False)