import os
import sqlite3
import jwt
import json
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# JWT token decorator
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
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
            request.current_user_id = current_user_id
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email')
        username = data.get('username')
        password = data.get('password')
        
        if not email or not username or not password:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash the password
        password_hash = pbkdf2_sha256.hash(password)
        
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
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Get user from database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, password_hash FROM users WHERE email = ?
        ''', (email,))
        
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        user_id, password_hash = user
        
        # Verify password
        if not pbkdf2_sha256.verify(password, password_hash):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': user_id,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
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
        
        if not data:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = data.get('username')
        secret = data.get('secret')
        
        if not username or secret is None:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Get user_id from username
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id FROM users WHERE username = ?
        ''', (username,))
        
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        user_id = user[0]
        
        # Check if the authenticated user matches the requested username
        if user_id != request.current_user_id:
            conn.close()
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Delete existing secret if any
        cursor.execute('''
            DELETE FROM secrets WHERE user_id = ?
        ''', (user_id,))
        
        # Insert new secret
        cursor.execute('''
            INSERT INTO secrets (user_id, secret)
            VALUES (?, ?)
        ''', (user_id, secret))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
    
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    try:
        username = request.args.get('username')
        
        if not username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Get user_id from username
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id FROM users WHERE username = ?
        ''', (username,))
        
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        user_id = user[0]
        
        # Check if the authenticated user matches the requested username
        if user_id != request.current_user_id:
            conn.close()
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Get secret
        cursor.execute('''
            SELECT secret FROM secrets WHERE user_id = ?
        ''', (user_id,))
        
        secret_row = cursor.fetchone()
        conn.close()
        
        if not secret_row:
            return jsonify({'secret': ''}), 200
        
        return jsonify({'secret': secret_row[0]}), 200
    
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)