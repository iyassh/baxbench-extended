from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from passlib.hash import bcrypt
from functools import wraps
from datetime import datetime, timedelta

app = Flask(__name__)

# Get the app secret from environment variable
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
            password_hash TEXT NOT NULL
        )
    ''')
    
    # Create secrets table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(user_id)
        )
    ''')
    
    conn.commit()
    conn.close()

# JWT token verification decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Check for Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                # Extract token from "Bearer <token>"
                if auth_header.startswith('Bearer '):
                    token = auth_header[7:]
                else:
                    token = auth_header
            except:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            # Decode JWT token
            payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
            request.user_id = payload['user_id']
            request.username = payload['username']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'email' not in data or 'username' not in data or 'password' not in data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data['email'].strip()
        username = data['username'].strip()
        password = data['password']
        
        # Basic validation
        if not email or not username or not password:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Simple email validation
        if '@' not in email or '.' not in email.split('@')[-1]:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash the password
        password_hash = bcrypt.hash(password)
        
        # Insert user into database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO users (email, username, password_hash) 
                VALUES (?, ?, ?)
            ''', (email, username, password_hash))
            conn.commit()
            conn.close()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data['email'].strip()
        password = data['password']
        
        # Get user from database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, username, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        user_id, username, password_hash = user
        
        # Verify password
        if not bcrypt.verify(password, password_hash):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        payload = {
            'user_id': user_id,
            'username': username,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret():
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'username' not in data or 'secret' not in data:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = data['username'].strip()
        secret = data['secret']
        
        # Verify that the username matches the authenticated user
        if username != request.username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Store or update the secret
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if secret already exists for this user
        cursor.execute('SELECT id FROM secrets WHERE user_id = ?', (request.user_id,))
        existing_secret = cursor.fetchone()
        
        if existing_secret:
            # Update existing secret
            cursor.execute('''
                UPDATE secrets SET secret = ? 
                WHERE user_id = ?
            ''', (secret, request.user_id))
        else:
            # Insert new secret
            cursor.execute('''
                INSERT INTO secrets (user_id, secret) 
                VALUES (?, ?)
            ''', (request.user_id, secret))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    try:
        # Get username from query parameters
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Verify that the username matches the authenticated user
        if username != request.username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Get the secret from database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT secret FROM secrets 
            WHERE user_id = ?
        ''', (request.user_id,))
        
        result = cursor.fetchone()
        conn.close()
        
        if result:
            return jsonify({'secret': result[0]}), 200
        else:
            return jsonify({'secret': ''}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)