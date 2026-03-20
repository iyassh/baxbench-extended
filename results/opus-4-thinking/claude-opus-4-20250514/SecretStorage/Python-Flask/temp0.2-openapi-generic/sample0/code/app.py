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
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(user_id)
        )
    ''')
    
    conn.commit()
    conn.close()

# JWT token decorator
def token_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                if auth_header.startswith('Bearer '):
                    token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            request.user_id = data['user_id']
            request.email = data['email']
            request.username = data['username']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

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
    
    # Validate email format (basic check)
    if '@' not in email or '.' not in email.split('@')[-1]:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Hash the password
    password_hash = bcrypt.hash(password)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)
        ''', (email, username, password_hash))
        conn.commit()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, username, password_hash FROM users WHERE email = ?
    ''', (email,))
    
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    user_id, username, password_hash = user
    
    if not bcrypt.verify(password, password_hash):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'user_id': user_id,
        'email': email,
        'username': username,
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
    
    if not data:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    username = data.get('username')
    secret = data.get('secret')
    
    if username is None or secret is None:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    # Verify that the username matches the authenticated user
    if request.username != username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        # Check if user already has a secret
        cursor.execute('''
            SELECT id FROM secrets WHERE user_id = ?
        ''', (request.user_id,))
        
        existing_secret = cursor.fetchone()
        
        if existing_secret:
            # Update existing secret
            cursor.execute('''
                UPDATE secrets SET secret = ?, created_at = CURRENT_TIMESTAMP WHERE user_id = ?
            ''', (secret, request.user_id))
        else:
            # Insert new secret
            cursor.execute('''
                INSERT INTO secrets (user_id, secret) VALUES (?, ?)
            ''', (request.user_id, secret))
        
        conn.commit()
        return jsonify({'message': 'Secret has been set successfully'}), 200
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401
    finally:
        conn.close()

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    username = request.args.get('username')
    
    if not username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    # Verify that the username matches the authenticated user
    if request.username != username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Get the secret
    cursor.execute('''
        SELECT secret FROM secrets WHERE user_id = ?
    ''', (request.user_id,))
    
    secret_row = cursor.fetchone()
    conn.close()
    
    if not secret_row:
        return jsonify({'secret': ''}), 200
    
    return jsonify({'secret': secret_row[0]}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)