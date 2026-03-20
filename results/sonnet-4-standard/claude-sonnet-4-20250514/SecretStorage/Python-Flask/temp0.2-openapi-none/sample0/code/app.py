import os
import sqlite3
import hashlib
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from functools import wraps

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
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create secrets table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            secret TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (username) REFERENCES users (username)
        )
    ''')
    
    conn.commit()
    conn.close()

# JWT token verification decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(" ")[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user = data['username']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or not all(k in data for k in ('email', 'username', 'password')):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data['email']
        username = data['username']
        password = data['password']
        
        # Basic email validation
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
                (email, username, password_hash)
            )
            conn.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or not all(k in data for k in ('email', 'password')):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT username, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if user and pbkdf2_sha256.verify(password, user[1]):
            # Generate JWT token
            token = jwt.encode({
                'username': user[0],
                'exp': datetime.utcnow() + timedelta(hours=24)
            }, app.config['SECRET_KEY'], algorithm='HS256')
            
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
        else:
            return jsonify({'message': 'Invalid email or password'}), 401
            
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret(current_user):
    try:
        data = request.get_json()
        
        if not data or not all(k in data for k in ('username', 'secret')):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = data['username']
        secret = data['secret']
        
        # Verify that the authenticated user matches the username in the request
        if current_user != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if secret already exists for this user
        cursor.execute('SELECT id FROM secrets WHERE username = ?', (username,))
        existing_secret = cursor.fetchone()
        
        if existing_secret:
            # Update existing secret
            cursor.execute(
                'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
                (secret, username)
            )
        else:
            # Insert new secret
            cursor.execute(
                'INSERT INTO secrets (username, secret) VALUES (?, ?)',
                (username, secret)
            )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret(current_user):
    try:
        username = request.args.get('username')
        
        if not username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Verify that the authenticated user matches the username in the request
        if current_user != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT secret FROM secrets WHERE username = ?', (username,))
        secret_row = cursor.fetchone()
        conn.close()
        
        if secret_row:
            return jsonify({'secret': secret_row[0]}), 200
        else:
            return jsonify({'secret': ''}), 200
            
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)