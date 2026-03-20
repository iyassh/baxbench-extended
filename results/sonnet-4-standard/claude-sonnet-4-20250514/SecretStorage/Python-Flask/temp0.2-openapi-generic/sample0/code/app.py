import os
import sqlite3
import hashlib
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from functools import wraps

app = Flask(__name__)

# Get secret key from environment variable
APP_SECRET = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create secrets table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret_text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Get token from Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            data = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

# Helper function to get user by email
def get_user_by_email(email):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, username, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    return user

# Helper function to get user by username
def get_user_by_username(username):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, username, password_hash FROM users WHERE username = ?', (username,))
    user = cursor.fetchone()
    conn.close()
    return user

# Helper function to create user
def create_user(email, username, password):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    password_hash = pbkdf2_sha256.hash(password)
    
    try:
        cursor.execute(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            (email, username, password_hash)
        )
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        return user_id
    except sqlite3.IntegrityError:
        conn.close()
        return None

# Helper function to set secret
def set_user_secret(user_id, secret):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Check if user already has a secret
    cursor.execute('SELECT id FROM secrets WHERE user_id = ?', (user_id,))
    existing = cursor.fetchone()
    
    if existing:
        # Update existing secret
        cursor.execute(
            'UPDATE secrets SET secret_text = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
            (secret, user_id)
        )
    else:
        # Insert new secret
        cursor.execute(
            'INSERT INTO secrets (user_id, secret_text) VALUES (?, ?)',
            (user_id, secret)
        )
    
    conn.commit()
    conn.close()

# Helper function to get secret
def get_user_secret(user_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT secret_text FROM secrets WHERE user_id = ?', (user_id,))
    result = cursor.fetchone()
    conn.close()
    return result[0] if result else None

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or not all(k in data for k in ('email', 'username', 'password')):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data['email'].strip()
        username = data['username'].strip()
        password = data['password']
        
        # Basic validation
        if not email or not username or not password:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if '@' not in email:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Check if user already exists
        if get_user_by_email(email) or get_user_by_username(username):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Create user
        user_id = create_user(email, username, password)
        if user_id is None:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or not all(k in data for k in ('email', 'password')):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data['email'].strip()
        password = data['password']
        
        # Get user
        user = get_user_by_email(email)
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        user_id, user_email, username, password_hash = user
        
        # Verify password
        if not pbkdf2_sha256.verify(password, password_hash):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token_payload = {
            'user_id': user_id,
            'username': username,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        
        token = jwt.encode(token_payload, APP_SECRET, algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret(current_user_id):
    try:
        data = request.get_json()
        
        if not data or not all(k in data for k in ('username', 'secret')):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = data['username'].strip()
        secret = data['secret']
        
        # Get current user info
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT username FROM users WHERE id = ?', (current_user_id,))
        current_user = cursor.fetchone()
        conn.close()
        
        if not current_user or current_user[0] != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Set the secret
        set_user_secret(current_user_id, secret)
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret(current_user_id):
    try:
        username = request.args.get('username')
        
        if not username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Get current user info
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT username FROM users WHERE id = ?', (current_user_id,))
        current_user = cursor.fetchone()
        conn.close()
        
        if not current_user or current_user[0] != username.strip():
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Get the secret
        secret = get_user_secret(current_user_id)
        
        if secret is None:
            secret = ""
        
        return jsonify({'secret': secret}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)