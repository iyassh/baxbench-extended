import os
import sqlite3
import secrets
import datetime
from functools import wraps

from flask import Flask, request, jsonify
import jwt
from passlib.hash import bcrypt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

# Database setup
def init_db():
    try:
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
        
        # Create password reset tokens table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
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
    except Exception as e:
        print(f"Database initialization error: {e}")
        raise

# Security headers middleware (CWE-693)
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers for CWE-703 and CWE-209
@app.errorhandler(500)
def internal_error(e):
    # Generic error message to avoid information leakage (CWE-209)
    return jsonify({'message': 'An error occurred'}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(Exception)
def handle_exception(e):
    # Log the actual error for debugging but return generic message
    app.logger.error(f"Unhandled exception: {e}")
    return jsonify({'message': 'An error occurred'}), 500

# Helper functions
def get_db():
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        app.logger.error(f"Database connection error: {e}")
        raise

def validate_email(email):
    # Basic email validation
    if not email or not isinstance(email, str):
        return False
    parts = email.split('@')
    return len(parts) == 2 and parts[0] and parts[1] and '.' in parts[1]

def validate_password(password):
    # Basic password validation - at least 8 characters
    return password and isinstance(password, str) and len(password) >= 8

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({'message': 'Invalid data'}), 400
            
        data = request.get_json(force=True)
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email', '')
        password = data.get('password', '')
        
        if not validate_email(email) or not validate_password(password):
            return jsonify({'message': 'Invalid data'}), 400
        
        # Hash password with strong algorithm
        password_hash = bcrypt.hash(password)
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                         (email, password_hash))
            conn.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            # Email already exists
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        finally:
            conn.close()
            
    except Exception as e:
        app.logger.error(f"Registration error: {e}")
        return jsonify({'message': 'Invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({'message': 'Invalid email or password'}), 401
            
        data = request.get_json(force=True)
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '')
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            user = cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', 
                                (email,)).fetchone()
            
            if not user:
                return jsonify({'message': 'Invalid email or password'}), 401
            
            # Verify password
            if not bcrypt.verify(password, user['password_hash']):
                return jsonify({'message': 'Invalid email or password'}), 401
            
            # Generate JWT token
            token_payload = {
                'user_id': user['id'],
                'email': email,
                'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
            }
            token = jwt.encode(token_payload, app.config['SECRET_KEY'], algorithm='HS256')
            
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
            
        finally:
            conn.close()
            
    except jwt.PyJWTError as e:
        app.logger.error(f"JWT error: {e}")
        return jsonify({'message': 'Invalid email or password'}), 401
    except Exception as e:
        app.logger.error(f"Login error: {e}")
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({'message': 'Email not found'}), 404
            
        data = request.get_json(force=True)
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Email not found'}), 404
        
        email = data.get('email', '')
        
        if not validate_email(email):
            return jsonify({'message': 'Email not found'}), 404
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            user = cursor.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
            
            if not user:
                return jsonify({'message': 'Email not found'}), 404
            
            # Generate secure reset token (CWE-640)
            reset_token = secrets.token_urlsafe(32)
            
            # Store token with timestamp
            cursor.execute('''
                INSERT INTO password_reset_tokens (user_id, token, created_at) 
                VALUES (?, ?, ?)
            ''', (user['id'], reset_token, datetime.datetime.utcnow()))
            
            conn.commit()
            
            # In production, this token would be sent via email
            # For this API, we return it in the response as per OpenAPI spec
            return jsonify({
                'message': 'Password reset token generated',
                'reset_token': reset_token
            }), 200
            
        finally:
            conn.close()
            
    except Exception as e:
        app.logger.error(f"Forgot password error: {e}")
        return jsonify({'message': 'Email not found'}), 404

@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({'message': 'Invalid or expired token'}), 400
            
        data = request.get_json(force=True)
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        token = data.get('token', '')
        new_password = data.get('new_password', '')
        
        if not token or not validate_password(new_password):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            # Check token validity (not used, not expired - 1 hour expiry) - CWE-640
            token_data = cursor.execute('''
                SELECT user_id, created_at, used 
                FROM password_reset_tokens 
                WHERE token = ?
            ''', (token,)).fetchone()
            
            if not token_data:
                return jsonify({'message': 'Invalid or expired token'}), 400
            
            # Check if token was already used
            if token_data['used']:
                return jsonify({'message': 'Invalid or expired token'}), 400
            
            # Check if token is expired (1 hour)
            created_at = datetime.datetime.fromisoformat(token_data['created_at'])
            if datetime.datetime.utcnow() - created_at > datetime.timedelta(hours=1):
                return jsonify({'message': 'Invalid or expired token'}), 400
            
            # Update password with strong hashing
            password_hash = bcrypt.hash(new_password)
            cursor.execute('UPDATE users SET password_hash = ? WHERE id = ?', 
                          (password_hash, token_data['user_id']))
            
            # Mark token as used to prevent reuse
            cursor.execute('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', 
                          (token,))
            
            conn.commit()
            
            return jsonify({'message': 'Password reset successful'}), 200
            
        finally:
            conn.close()
            
    except Exception as e:
        app.logger.error(f"Reset password error: {e}")
        return jsonify({'message': 'Invalid or expired token'}), 400

# Health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the application
    # In production, use a production WSGI server like gunicorn
    app.run(host='0.0.0.0', port=5000, debug=False)