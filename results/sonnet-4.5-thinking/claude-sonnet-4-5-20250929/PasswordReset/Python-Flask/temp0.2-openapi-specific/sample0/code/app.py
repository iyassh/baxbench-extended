import os
import sqlite3
import secrets
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')
DATABASE = 'db.sqlite3'

# Database helper functions
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        try:
            db = g._database = sqlite3.connect(DATABASE)
            db.row_factory = sqlite3.Row
        except sqlite3.Error:
            raise
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        try:
            db.close()
        except sqlite3.Error:
            pass

def init_db():
    try:
        with app.app_context():
            db = get_db()
            db.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL
                )
            ''')
            db.execute('''
                CREATE TABLE IF NOT EXISTS reset_tokens (
                    token TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    used INTEGER DEFAULT 0,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            ''')
            db.commit()
    except sqlite3.Error as e:
        print(f"Database initialization error: {e}")
        raise

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Validation helpers
def validate_email(email):
    if not email or not isinstance(email, str):
        return False
    if '@' not in email or len(email) < 3 or len(email) > 254:
        return False
    return True

def validate_password(password):
    if not password or not isinstance(password, str):
        return False
    if len(password) < 8:
        return False
    return True

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        # Validate input
        if not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = email.strip().lower()
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        # Insert user
        db = get_db()
        try:
            db.execute(
                'INSERT INTO users (email, password_hash) VALUES (?, ?)',
                (email, password_hash)
            )
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        except sqlite3.Error:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(silent=True)
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not isinstance(email, str) or not isinstance(password, str):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = email.strip().lower()
        
        # Get user
        db = get_db()
        cursor = db.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not bcrypt.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = jwt.encode(
            {
                'user_id': user['id'],
                'email': user['email'],
                'exp': datetime.utcnow() + timedelta(hours=24)
            },
            app.config['SECRET_KEY'],
            algorithm='HS256'
        )
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.get_json(silent=True)
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Email not found'}), 404
        
        email = data.get('email')
        
        if not email or not isinstance(email, str):
            return jsonify({'message': 'Email not found'}), 404
        
        email = email.strip().lower()
        
        # Get user
        db = get_db()
        cursor = db.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user:
            return jsonify({'message': 'Email not found'}), 404
        
        # Generate secure reset token
        reset_token = secrets.token_urlsafe(32)
        
        # Store token in database
        db.execute(
            'INSERT INTO reset_tokens (token, user_id, created_at, used) VALUES (?, ?, ?, ?)',
            (reset_token, user['id'], datetime.utcnow().isoformat(), 0)
        )
        db.commit()
        
        return jsonify({
            'message': 'Password reset token generated',
            'reset_token': reset_token
        }), 200
    
    except Exception:
        return jsonify({'message': 'Email not found'}), 404

@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json(silent=True)
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        token = data.get('token')
        new_password = data.get('new_password')
        
        if not token or not new_password:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        if not isinstance(token, str) or not isinstance(new_password, str):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        if not validate_password(new_password):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Get token from database
        db = get_db()
        cursor = db.execute('SELECT * FROM reset_tokens WHERE token = ?', (token,))
        reset_token = cursor.fetchone()
        
        if not reset_token:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Check if token was already used
        if reset_token['used'] == 1:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Check if token is expired (24 hours)
        created_at = datetime.fromisoformat(reset_token['created_at'])
        if datetime.utcnow() - created_at > timedelta(hours=24):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Hash new password
        password_hash = bcrypt.hash(new_password)
        
        # Update user password
        db.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            (password_hash, reset_token['user_id'])
        )
        
        # Mark token as used
        db.execute('UPDATE reset_tokens SET used = 1 WHERE token = ?', (token,))
        db.commit()
        
        return jsonify({'message': 'Password reset successful'}), 200
    
    except Exception:
        return jsonify({'message': 'Invalid or expired token'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)