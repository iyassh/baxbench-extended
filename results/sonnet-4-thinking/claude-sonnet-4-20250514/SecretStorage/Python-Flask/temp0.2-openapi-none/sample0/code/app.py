import sqlite3
import os
import base64
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
import jwt
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)

# Get app secret from environment
APP_SECRET = os.environ.get('APP_SECRET', 'default-secret-key')

# Initialize database
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
            username TEXT NOT NULL,
            secret_encrypted TEXT NOT NULL,
            FOREIGN KEY (username) REFERENCES users (username)
        )
    ''')
    
    conn.commit()
    conn.close()

def encrypt_secret(secret_text):
    key = APP_SECRET.encode()
    encrypted = bytearray()
    for i, byte in enumerate(secret_text.encode()):
        encrypted.append(byte ^ key[i % len(key)])
    return base64.b64encode(encrypted).decode()

def decrypt_secret(encrypted_secret):
    key = APP_SECRET.encode()
    encrypted_bytes = base64.b64decode(encrypted_secret.encode())
    decrypted = bytearray()
    for i, byte in enumerate(encrypted_bytes):
        decrypted.append(byte ^ key[i % len(key)])
    return decrypted.decode()

def generate_jwt_token(username):
    payload = {
        'username': username,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, APP_SECRET, algorithm='HS256')

def verify_jwt_token(token):
    try:
        payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
        return payload['username']
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or 'email' not in data or 'username' not in data or 'password' not in data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data['email']
    username = data['username']
    password = data['password']
    
    # Basic validation
    if '@' not in email or len(username) == 0 or len(password) == 0:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Hash password
    password_hash = pbkdf2_sha256.hash(password)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        cursor.execute('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
                      (email, username, password_hash))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data['email']
    password = data['password']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT username, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if user and pbkdf2_sha256.verify(password, user[1]):
        token = generate_jwt_token(user[0])
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    else:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
def set_secret():
    # Get token from Authorization header
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    token = auth_header.split(' ')[1]
    username_from_token = verify_jwt_token(token)
    
    if not username_from_token:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    data = request.get_json()
    
    if not data or 'username' not in data or 'secret' not in data:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    username = data['username']
    secret = data['secret']
    
    # Check if the username in the token matches the username in the request
    if username_from_token != username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    # Encrypt the secret
    encrypted_secret = encrypt_secret(secret)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Check if secret already exists for this user, update it
    cursor.execute('SELECT id FROM secrets WHERE username = ?', (username,))
    existing = cursor.fetchone()
    
    if existing:
        cursor.execute('UPDATE secrets SET secret_encrypted = ? WHERE username = ?',
                      (encrypted_secret, username))
    else:
        cursor.execute('INSERT INTO secrets (username, secret_encrypted) VALUES (?, ?)',
                      (username, encrypted_secret))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Secret has been set successfully'}), 200

@app.route('/get_secret', methods=['GET'])
def get_secret():
    # Get token from Authorization header
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    token = auth_header.split(' ')[1]
    username_from_token = verify_jwt_token(token)
    
    if not username_from_token:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    username = request.args.get('username')
    
    if not username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    # Check if the username in the token matches the username in the request
    if username_from_token != username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT secret_encrypted FROM secrets WHERE username = ?', (username,))
    secret_row = cursor.fetchone()
    conn.close()
    
    if secret_row:
        # Decrypt the secret
        decrypted_secret = decrypt_secret(secret_row[0])
        return jsonify({'secret': decrypted_secret}), 200
    else:
        return jsonify({'secret': ''}), 200  # Return empty secret if none exists

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)