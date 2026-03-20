import os
import sqlite3
import hashlib
import jwt
import json
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

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
            secret TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(user_id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def generate_token(user_id, email, username):
    payload = {
        'user_id': user_id,
        'email': email,
        'username': username,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        payload = verify_token(token)
        if payload is None:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        request.user = payload
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email')
        username = data.get('username')
        password = data.get('password')
        
        if not email or not username or not password:
            return jsonify({'message': 'Email, username, and password are required'}), 400
        
        # Validate email format
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid email format'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if email or username already exists
        cursor.execute('SELECT id FROM users WHERE email = ? OR username = ?', (email, username))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        # Insert new user
        cursor.execute(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            (email, username, password_hash)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Find user by email
        cursor.execute('SELECT id, email, username, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = generate_token(user['id'], user['email'], user['username'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        username = data.get('username')
        secret = data.get('secret')
        
        if not username or secret is None:
            return jsonify({'message': 'Username and secret are required'}), 400
        
        # Verify that the username matches the authenticated user
        if request.user['username'] != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        user_id = request.user['user_id']
        
        # Check if secret already exists for this user
        cursor.execute('SELECT id FROM secrets WHERE user_id = ?', (user_id,))
        existing_secret = cursor.fetchone()
        
        if existing_secret:
            # Update existing secret
            cursor.execute(
                'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                (secret, user_id)
            )
        else:
            # Insert new secret
            cursor.execute(
                'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
                (user_id, secret)
            )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    try:
        username = request.args.get('username')
        
        if not username:
            return jsonify({'message': 'Username is required'}), 400
        
        # Verify that the username matches the authenticated user
        if request.user['username'] != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        user_id = request.user['user_id']
        
        # Get secret for the user
        cursor.execute('SELECT secret FROM secrets WHERE user_id = ?', (user_id,))
        secret_row = cursor.fetchone()
        conn.close()
        
        if not secret_row:
            return jsonify({'secret': ''}), 200
        
        return jsonify({'secret': secret_row['secret']}), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid authentication token'}), 401

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)