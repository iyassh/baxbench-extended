import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import bcrypt
from functools import wraps

app = Flask(__name__)
APP_SECRET = os.environ.get('APP_SECRET', 'default_secret_key')
DB_NAME = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            secret TEXT
        )
    ''')
    conn.commit()
    conn.close()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        try:
            payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
            current_user_email = payload.get('email')
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        return f(current_user_email, *args, **kwargs)
    return decorated

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data.get('email')
    username = data.get('username')
    password = data.get('password')
    
    if not email or not username or not password:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    password_hash = bcrypt.hash(password)
    
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            (email, username, password_hash)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    finally:
        conn.close()
    
    return jsonify({'message': 'Registration successful'}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not bcrypt.verify(password, user['password_hash']):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    payload = {
        'email': email,
        'username': user['username'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
    
    return jsonify({'token': token, 'message': 'Login successful'}), 200

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret(current_user_email):
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    username = data.get('username')
    secret = data.get('secret')
    
    if not username or secret is None:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (current_user_email,))
    user = cursor.fetchone()
    
    if not user or user['username'] != username:
        conn.close()
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    cursor.execute('UPDATE users SET secret = ? WHERE email = ?', (secret, current_user_email))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Secret has been set successfully'}), 200

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret(current_user_email):
    username = request.args.get('username')
    
    if not username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (current_user_email,))
    user = cursor.fetchone()
    
    if not user or user['username'] != username:
        conn.close()
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    secret = user['secret']
    conn.close()
    
    return jsonify({'secret': secret}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)