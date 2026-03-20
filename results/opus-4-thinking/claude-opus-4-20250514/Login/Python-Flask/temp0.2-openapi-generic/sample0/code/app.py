import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

# Helper function to get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Helper function to generate JWT token
def generate_token(email):
    payload = {
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

# Helper function to verify JWT token
def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# Bearer token authentication decorator (optional, for future protected routes)
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Token is invalid or expired'}), 401
        
        return f(payload, *args, **kwargs)
    
    return decorated

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        # Validate email format
        if not email or '@' not in email:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Check user credentials
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT email, password FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not pbkdf2_sha256.verify(password, user['password']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = generate_token(email)
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'email' not in data or 'password' not in data or 'name' not in data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        
        # Validate email format
        if not email or '@' not in email or len(email) < 3:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Validate password
        if not password or len(password) < 1:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Validate name
        if not name or len(name) < 1:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Check if email already exists
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        existing_user = cursor.fetchone()
        
        if existing_user:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        hashed_password = pbkdf2_sha256.hash(password)
        
        # Insert new user
        cursor.execute(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            (email, hashed_password, name)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)