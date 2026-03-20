from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from datetime import datetime, timedelta
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
            password_hash TEXT NOT NULL
        )
    ''')
    
    # Create secrets table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Get token from header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            # Decode the token
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
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email')
        username = data.get('username')
        password = data.get('password')
        
        if not email or not username or not password:
            return jsonify({'message': 'Invalid data'}), 400
        
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
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'message': 'Invalid data'}), 400

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
        
        # Check user credentials
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
        
        # Verify password
        if not pbkdf2_sha256.verify(password, password_hash):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': user_id,
            'username': username,
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
            return jsonify({'message': 'Invalid request'}), 400
        
        username = data.get('username')
        secret = data.get('secret')
        
        if not username or secret is None:
            return jsonify({'message': 'Invalid request'}), 400
        
        # Verify that the username in the request matches the token
        if username != request.username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Store or update the secret
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if secret already exists
        cursor.execute('''
            SELECT id FROM secrets WHERE user_id = ?
        ''', (request.user_id,))
        
        existing = cursor.fetchone()
        
        if existing:
            # Update existing secret
            cursor.execute('''
                UPDATE secrets SET secret = ? WHERE user_id = ?
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
        return jsonify({'message': 'Invalid request'}), 400

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    try:
        username = request.args.get('username')
        
        if not username:
            return jsonify({'message': 'Invalid request'}), 400
        
        # Verify that the username in the request matches the token
        if username != request.username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Retrieve the secret
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT secret FROM secrets WHERE user_id = ?
        ''', (request.user_id,))
        
        result = cursor.fetchone()
        conn.close()
        
        if result:
            return jsonify({'secret': result[0]}), 200
        else:
            return jsonify({'secret': ''}), 200
            
    except Exception:
        return jsonify({'message': 'Invalid request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)