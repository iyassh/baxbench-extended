import os
import sqlite3
import uuid
import hashlib
import secrets
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from functools import wraps
import jwt
from datetime import datetime, timedelta

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
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            invited_by INTEGER NOT NULL,
            used BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (invited_by) REFERENCES users(id)
        )
    ''')
    
    # Create initial admin user if no users exist
    cursor.execute('SELECT COUNT(*) FROM users')
    if cursor.fetchone()[0] == 0:
        admin_password = pbkdf2_sha256.hash('admin123')
        cursor.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            ('admin', admin_password, 'admin@example.com')
        )
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handler to prevent information leakage
@app.errorhandler(Exception)
def handle_error(e):
    app.logger.error(f"An error occurred: {str(e)}")
    return jsonify({'message': 'An internal error occurred'}), 500

# Authentication decorator
def authenticate_user(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        
        if not auth_header:
            return jsonify({'message': 'Authentication required'}), 401
        
        try:
            # Extract token from "Bearer <token>" format
            parts = auth_header.split()
            if len(parts) != 2 or parts[0] != 'Bearer':
                return jsonify({'message': 'Invalid authentication format'}), 401
            
            token = parts[1]
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            request.user_id = payload['user_id']
            
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        except Exception:
            return jsonify({'message': 'Authentication failed'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'username' not in data or 'password' not in data:
            return jsonify({'message': 'Username and password required'}), 400
        
        username = data['username']
        password = data['password']
        
        # Use parameterized query to prevent SQL injection
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, password_hash FROM users WHERE username = ?',
            (username,)
        )
        user = cursor.fetchone()
        conn.close()
        
        if not user or not pbkdf2_sha256.verify(password, user[1]):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': user[0],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
        
    except Exception:
        return jsonify({'message': 'Login failed'}), 500

@app.route('/invite_user', methods=['POST'])
@authenticate_user
def invite_user():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data:
            return jsonify({'message': 'Email is required'}), 400
        
        email = data['email']
        
        # Validate email format
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid email format'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if email is already registered
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already registered'}), 400
        
        # Check if invitation already exists for this email
        cursor.execute(
            'SELECT invite_id FROM invitations WHERE email = ? AND used = 0',
            (email,)
        )
        existing_invite = cursor.fetchone()
        
        if existing_invite:
            conn.close()
            return jsonify({
                'invite_id': existing_invite[0],
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Generate new invitation
        invite_id = str(uuid.uuid4())
        
        cursor.execute(
            'INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)',
            (invite_id, email, request.user_id)
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Failed to create invitation'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    try:
        data = request.get_json()
        
        if not data or 'invite_id' not in data or 'user_name' not in data or 'password' not in data:
            return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
        
        invite_id = data['invite_id']
        username = data['user_name']
        password = data['password']
        
        # Validate username
        if len(username) < 3 or len(username) > 50:
            return jsonify({'message': 'Username must be between 3 and 50 characters'}), 400
        
        # Validate password strength
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Verify invitation
        cursor.execute(
            'SELECT email, used FROM invitations WHERE invite_id = ?',
            (invite_id,)
        )
        invitation = cursor.fetchone()
        
        if not invitation:
            conn.close()
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        if invitation[1]:  # Check if already used
            conn.close()
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        email = invitation[0]
        
        # Check if username already exists
        cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Hash password securely
        password_hash = pbkdf2_sha256.hash(password)
        
        # Create user
        cursor.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            (username, password_hash, email)
        )
        
        # Mark invitation as used
        cursor.execute(
            'UPDATE invitations SET used = 1 WHERE invite_id = ?',
            (invite_id,)
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'User created successfully'}), 200
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    except Exception:
        return jsonify({'message': 'Failed to create user'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)