import os
import sqlite3
import uuid
import hashlib
import secrets
from functools import wraps
from flask import Flask, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=1)

DATABASE = 'db.sqlite3'

def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    with get_db() as db:
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS invitations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invite_id TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                created_by INTEGER NOT NULL,
                used BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users (id)
            )
        ''')
        # Create a default admin user if no users exist
        cursor = db.execute('SELECT COUNT(*) as count FROM users')
        if cursor.fetchone()['count'] == 0:
            admin_password = generate_password_hash('admin123')
            db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', 
                      ('admin', admin_password))
        db.commit()

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'message': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data or 'username' not in data or 'password' not in data:
            return jsonify({'message': 'Username and password required'}), 400
        
        username = data['username']
        password = data['password']
        
        with get_db() as db:
            cursor = db.execute('SELECT id, password_hash FROM users WHERE username = ?', (username,))
            user = cursor.fetchone()
            
            if user and check_password_hash(user['password_hash'], password):
                session['user_id'] = user['id']
                session.permanent = True
                return jsonify({'message': 'Login successful'}), 200
            else:
                return jsonify({'message': 'Invalid credentials'}), 401
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    session.clear()
    return jsonify({'message': 'Logout successful'}), 200

@app.route('/invite_user', methods=['POST'])
@login_required
def invite_user():
    try:
        data = request.get_json()
        if not data or 'email' not in data:
            return jsonify({'message': 'Email is required'}), 400
        
        email = data['email'].strip().lower()
        
        # Validate email format
        if not email or '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        user_id = session['user_id']
        
        with get_db() as db:
            # Check if invitation already exists for this email
            cursor = db.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
            existing = cursor.fetchone()
            
            if existing:
                return jsonify({
                    'invite_id': existing['invite_id'],
                    'message': 'Invitation already exists for this email'
                }), 200
            
            # Generate unique invite ID
            invite_id = str(uuid.uuid4())
            
            # Create new invitation
            db.execute(
                'INSERT INTO invitations (invite_id, email, created_by) VALUES (?, ?, ?)',
                (invite_id, email, user_id)
            )
            db.commit()
            
            return jsonify({
                'invite_id': invite_id,
                'message': 'Invitation created successfully'
            }), 200
            
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    try:
        data = request.get_json()
        if not data or not all(k in data for k in ['invite_id', 'user_name', 'password']):
            return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
        
        invite_id = data['invite_id'].strip()
        username = data['user_name'].strip()
        password = data['password']
        
        # Validate inputs
        if not invite_id or not username or not password:
            return jsonify({'message': 'All fields are required'}), 400
        
        if len(username) < 3 or len(username) > 50:
            return jsonify({'message': 'Username must be between 3 and 50 characters'}), 400
        
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        with get_db() as db:
            # Check if invite_id is valid and unused
            cursor = db.execute(
                'SELECT id, used FROM invitations WHERE invite_id = ?',
                (invite_id,)
            )
            invitation = cursor.fetchone()
            
            if not invitation:
                return jsonify({'message': 'Invalid invite_id'}), 401
            
            if invitation['used']:
                return jsonify({'message': 'Invalid invite_id'}), 401
            
            # Check if username already exists
            cursor = db.execute('SELECT id FROM users WHERE username = ?', (username,))
            if cursor.fetchone():
                return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
            
            # Create user
            password_hash = generate_password_hash(password)
            cursor = db.execute(
                'INSERT INTO users (username, password_hash) VALUES (?, ?)',
                (username, password_hash)
            )
            
            # Mark invitation as used
            db.execute(
                'UPDATE invitations SET used = 1 WHERE id = ?',
                (invitation['id'],)
            )
            
            db.commit()
            
            return jsonify({'message': 'User created successfully'}), 200
            
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)