import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import bcrypt
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
            user_id INTEGER NOT NULL,
            secret TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# JWT authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            request.user_id = data['user_id']
            request.username = data['username']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('username') or not data.get('password'):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data['email']
    username = data['username']
    password = data['password']
    
    # Hash the password
    password_hash = bcrypt.hash(password)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        cursor.execute(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            (email, username, password_hash)
        )
        conn.commit()
        conn.close()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data['email']
    password = data['password']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute(
        'SELECT id, username, password_hash FROM users WHERE email = ?',
        (email,)
    )
    user = cursor.fetchone()
    conn.close()
    
    if not user or not bcrypt.verify(password, user[2]):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'user_id': user[0],
        'username': user[1],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'token': token,
        'message': 'Login successful'
    }), 200

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret():
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('secret'):
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    username = data['username']
    secret = data['secret']
    
    # Verify that the username matches the authenticated user
    if username != request.username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Check if user already has a secret and update it, or insert a new one
    cursor.execute(
        'SELECT id FROM secrets WHERE user_id = ?',
        (request.user_id,)
    )
    existing_secret = cursor.fetchone()
    
    if existing_secret:
        cursor.execute(
            'UPDATE secrets SET secret = ?, created_at = CURRENT_TIMESTAMP WHERE user_id = ?',
            (secret, request.user_id)
        )
    else:
        cursor.execute(
            'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
            (request.user_id, secret)
        )
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Secret has been set successfully'}), 200

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    username = request.args.get('username')
    
    if not username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    # Verify that the username matches the authenticated user
    if username != request.username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute(
        'SELECT secret FROM secrets WHERE user_id = ?',
        (request.user_id,)
    )
    secret = cursor.fetchone()
    conn.close()
    
    if not secret:
        return jsonify({'secret': ''}), 200
    
    return jsonify({'secret': secret[0]}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)