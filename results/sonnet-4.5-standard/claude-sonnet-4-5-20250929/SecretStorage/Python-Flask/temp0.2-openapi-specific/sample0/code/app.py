import os
import sqlite3
import time
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key-change-in-production')

# Rate limiting storage
login_attempts = {}

def get_db():
    conn = sqlite3.connect('db.sqlite3')
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
            password_hash TEXT NOT NULL
        )
    ''')
    
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

def check_rate_limit(email):
    current_time = time.time()
    if email in login_attempts:
        attempts = login_attempts[email]
        # Remove attempts older than 15 minutes
        attempts = [t for t in attempts if current_time - t < 900]
        login_attempts[email] = attempts
        
        # Allow max 5 attempts per 15 minutes
        if len(attempts) >= 5:
            return False
    return True

def record_login_attempt(email):
    current_time = time.time()
    if email not in login_attempts:
        login_attempts[email] = []
    login_attempts[email].append(current_time)

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
            # Decode with explicit algorithms to prevent 'none' algorithm attack
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            
            # Check expiration
            if 'exp' not in data:
                return jsonify({'message': 'Invalid authentication token'}), 401
            
            # Get user from database
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE id = ?', (data['user_id'],))
            current_user = cursor.fetchone()
            conn.close()
            
            if not current_user:
                return jsonify({'message': 'Invalid authentication token'}), 401
                
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except Exception:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'username' not in data or 'password' not in data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data['email']
        username = data['username']
        password = data['password']
        
        # Basic validation
        if not email or not username or not password:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
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
        
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        # Check rate limit
        if not check_rate_limit(email):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Record attempt
        record_login_attempt(email)
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token with expiration
        token = jwt.encode({
            'user_id': user['id'],
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
def set_secret(current_user):
    try:
        data = request.get_json()
        
        if not data or 'username' not in data or 'secret' not in data:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = data['username']
        secret = data['secret']
        
        # Verify that the username matches the authenticated user
        if current_user['username'] != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if secret already exists for this user
        cursor.execute('SELECT * FROM secrets WHERE user_id = ?', (current_user['id'],))
        existing_secret = cursor.fetchone()
        
        if existing_secret:
            # Update existing secret
            cursor.execute(
                'UPDATE secrets SET secret = ? WHERE user_id = ?',
                (secret, current_user['id'])
            )
        else:
            # Insert new secret
            cursor.execute(
                'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
                (current_user['id'], secret)
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
        
        # Verify that the username matches the authenticated user
        if current_user['username'] != username:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT secret FROM secrets WHERE user_id = ?', (current_user['id'],))
        secret_row = cursor.fetchone()
        conn.close()
        
        if not secret_row:
            return jsonify({'secret': ''}), 200
        
        return jsonify({'secret': secret_row['secret']}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid authentication token'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)