import os
import sqlite3
import hashlib
import secrets
import jwt
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify
from passlib.hash import bcrypt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))

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
            secret_encrypted TEXT NOT NULL,
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

def encrypt_secret(secret, user_id):
    # Simple encryption using hash of user_id and app secret
    key = hashlib.sha256(f"{user_id}{app.config['SECRET_KEY']}".encode()).hexdigest()
    encrypted = ''.join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(secret))
    return encrypted.encode('unicode_escape').decode('ascii')

def decrypt_secret(encrypted, user_id):
    # Decrypt the secret
    key = hashlib.sha256(f"{user_id}{app.config['SECRET_KEY']}".encode()).hexdigest()
    encrypted = encrypted.encode('ascii').decode('unicode_escape')
    decrypted = ''.join(chr(ord(c) ^ ord(key[i % len(key)])) for i, c in enumerate(encrypted))
    return decrypted

def generate_token(user_id, email):
    payload = {
        'user_id': user_id,
        'email': email,
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
        
        email = data.get('email', '').strip()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        # Validate input
        if not email or not username or not password:
            return jsonify({'message': 'Email, username, and password are required'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Password length check
        if len(password) < 6:
            return jsonify({'message': 'Password must be at least 6 characters'}), 400
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        # Store in database
        conn = get_db()
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
            
    except Exception as e:
        return jsonify({'message': 'Invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Get user from database
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not bcrypt.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate token
        token = generate_token(user['id'], user['email'])
        
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
        
        username = data.get('username', '').strip()
        secret = data.get('secret', '')
        
        if not username or secret is None:
            return jsonify({'message': 'Username and secret are required'}), 400
        
        # Get user from database
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'User not found'}), 404
        
        # Verify that the token belongs to the user trying to set the secret
        if request.user['user_id'] != user['id']:
            conn.close()
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Encrypt the secret
        encrypted_secret = encrypt_secret(secret, user['id'])
        
        # Store or update secret
        cursor.execute(
            '''INSERT INTO secrets (user_id, secret_encrypted) 
               VALUES (?, ?) 
               ON CONFLICT(user_id) 
               DO UPDATE SET secret_encrypted = ?, updated_at = CURRENT_TIMESTAMP''',
            (user['id'], encrypted_secret, encrypted_secret)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
        
    except Exception as e:
        return jsonify({'message': 'Error setting secret'}), 500

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    try:
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({'message': 'Username is required'}), 400
        
        # Get user and secret from database
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT u.id, s.secret_encrypted 
            FROM users u 
            LEFT JOIN secrets s ON u.id = s.user_id 
            WHERE u.username = ?
        ''', (username,))
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return jsonify({'message': 'User not found'}), 404
        
        # Verify that the token belongs to the user trying to get the secret
        if request.user['user_id'] != result['id']:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not result['secret_encrypted']:
            return jsonify({'secret': ''}), 200
        
        # Decrypt the secret
        secret = decrypt_secret(result['secret_encrypted'], result['id'])
        
        return jsonify({'secret': secret}), 200
        
    except Exception as e:
        return jsonify({'message': 'Error retrieving secret'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)