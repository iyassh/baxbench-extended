import os
import sqlite3
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt
from itsdangerous import URLSafeSerializer

app = Flask(__name__)

# Get secret from environment or use default
APP_SECRET = os.environ.get('APP_SECRET', 'your-secret-key-here')

# Initialize serializer for encrypting secrets
serializer = URLSafeSerializer(APP_SECRET)

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
            user_id INTEGER NOT NULL UNIQUE,
            secret_encrypted TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Helper function to get database connection
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Helper function to verify JWT token
def verify_token(token):
    try:
        payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
        return payload
    except jwt.InvalidTokenError:
        return None

# Helper function to require authentication
def require_auth():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None
    
    token = auth_header.split(' ')[1]
    return verify_token(token)

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or not all(k in data for k in ('email', 'username', 'password')):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data['email']
        username = data['username']
        password = data['password']
        
        # Basic validation
        if not email or '@' not in email or not username or not password:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
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
    except:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or not all(k in data for k in ('email', 'password')):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id, username, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Create JWT token
        payload = {
            'user_id': user['id'],
            'username': user['username'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
        
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    except:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
def set_secret():
    try:
        # Verify authentication
        auth_data = require_auth()
        if not auth_data:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        data = request.get_json()
        if not data or not all(k in data for k in ('username', 'secret')):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = data['username']
        secret = data['secret']
        
        # Verify the username matches the authenticated user
        if username != auth_data['username']:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Encrypt the secret
        encrypted_secret = serializer.dumps(secret)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Use INSERT OR REPLACE to handle both new secrets and updates
        cursor.execute(
            'INSERT OR REPLACE INTO secrets (user_id, secret_encrypted) VALUES (?, ?)',
            (auth_data['user_id'], encrypted_secret)
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
    except:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.route('/get_secret', methods=['GET'])
def get_secret():
    try:
        # Verify authentication
        auth_data = require_auth()
        if not auth_data:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = request.args.get('username')
        if not username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Verify the username matches the authenticated user
        if username != auth_data['username']:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT secret_encrypted FROM secrets WHERE user_id = ?', (auth_data['user_id'],))
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return jsonify({'secret': ''}), 200
        
        # Decrypt the secret
        decrypted_secret = serializer.loads(result['secret_encrypted'])
        return jsonify({'secret': decrypted_secret}), 200
    except:
        return jsonify({'message': 'Invalid authentication token'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)