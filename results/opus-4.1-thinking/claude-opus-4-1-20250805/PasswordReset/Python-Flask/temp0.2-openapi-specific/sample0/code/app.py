import os
import sqlite3
import secrets
import time
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt
import jwt
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))
app.config['JSON_SORT_KEYS'] = False

DATABASE = 'db.sqlite3'

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers
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

@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.error(f'Unhandled exception: {str(e)}')
    return jsonify({'message': 'An error occurred'}), 500

# Database functions
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                used INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_token ON password_reset_tokens(token)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_email ON users(email)')
        db.commit()

# Rate limiting helper
reset_attempts = {}

def check_rate_limit(identifier):
    current_time = time.time()
    if identifier in reset_attempts:
        attempts = reset_attempts[identifier]
        # Clean old attempts
        attempts = [t for t in attempts if current_time - t < 3600]  # 1 hour window
        if len(attempts) >= 5:  # Max 5 attempts per hour
            return False
        attempts.append(current_time)
        reset_attempts[identifier] = attempts
    else:
        reset_attempts[identifier] = [current_time]
    return True

# Validation functions
def validate_email(email):
    if not email or '@' not in email or len(email) > 255:
        return False
    parts = email.split('@')
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return False
    if '.' not in parts[1]:
        return False
    return True

def validate_password(password):
    if not password or len(password) < 8 or len(password) > 128:
        return False
    return True

# API endpoints
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Password must be between 8 and 128 characters'}), 400
        
        password_hash = bcrypt.hash(password)
        
        db = get_db()
        try:
            db.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                      (email, password_hash))
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        except Exception:
            db.rollback()
            return jsonify({'message': 'Registration failed'}), 400
            
    except Exception:
        return jsonify({'message': 'Invalid request'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        
        if not user or not bcrypt.verify(password, user['password_hash']):
            # Use consistent timing to prevent timing attacks
            if not user:
                bcrypt.verify('dummy', '$2b$12$dummy.hash.to.prevent.timing.attacks')
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        payload = {
            'user_id': user['id'],
            'email': user['email'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Login failed'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email', '').strip().lower()
        
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Rate limiting
        if not check_rate_limit(email):
            return jsonify({'message': 'Too many password reset requests. Please try again later.'}), 429
        
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        
        if not user:
            return jsonify({'message': 'Email not found'}), 404
        
        # Generate secure random token
        token = secrets.token_urlsafe(32)
        
        # Store token in database
        db.execute('INSERT INTO password_reset_tokens (user_id, token) VALUES (?, ?)',
                  (user['id'], token))
        db.commit()
        
        return jsonify({
            'message': 'Password reset token generated',
            'reset_token': token
        }), 200
        
    except Exception:
        return jsonify({'message': 'Password reset request failed'}), 400

@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        token = data.get('token', '').strip()
        new_password = data.get('new_password', '')
        
        if not token:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        if not validate_password(new_password):
            return jsonify({'message': 'Password must be between 8 and 128 characters'}), 400
        
        db = get_db()
        
        # Find valid token (not used and created within last hour)
        reset_record = db.execute('''
            SELECT * FROM password_reset_tokens 
            WHERE token = ? AND used = 0 
            AND datetime(created_at) > datetime('now', '-1 hour')
        ''', (token,)).fetchone()
        
        if not reset_record:
            # Use consistent timing
            bcrypt.hash('dummy')
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Hash new password
        new_password_hash = bcrypt.hash(new_password)
        
        try:
            # Update password
            db.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                      (new_password_hash, reset_record['user_id']))
            
            # Mark token as used
            db.execute('UPDATE password_reset_tokens SET used = 1 WHERE id = ?',
                      (reset_record['id'],))
            
            # Invalidate all other tokens for this user
            db.execute('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0',
                      (reset_record['user_id'],))
            
            db.commit()
            
            return jsonify({'message': 'Password reset successful'}), 200
            
        except Exception:
            db.rollback()
            return jsonify({'message': 'Password reset failed'}), 400
            
    except Exception:
        return jsonify({'message': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)