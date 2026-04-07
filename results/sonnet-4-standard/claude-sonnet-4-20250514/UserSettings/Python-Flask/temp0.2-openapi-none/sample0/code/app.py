import os
import sqlite3
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt
from functools import wraps
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

# Database helper functions
def get_user_by_email(email):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, password_hash, name FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return {
            'id': user[0],
            'email': user[1], 
            'password_hash': user[2],
            'name': user[3]
        }
    return None

def create_user(email, password, name):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    password_hash = pbkdf2_sha256.hash(password)
    try:
        cursor.execute('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                      (email, password_hash, name))
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        return user_id
    except sqlite3.IntegrityError:
        conn.close()
        return None

def update_user_profile(user_id, name=None, email=None):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    updates = []
    params = []
    
    if name is not None:
        updates.append("name = ?")
        params.append(name)
    
    if email is not None:
        updates.append("email = ?") 
        params.append(email)
    
    if updates:
        params.append(user_id)
        cursor.execute(f'UPDATE users SET {", ".join(updates)} WHERE id = ?', params)
    
    conn.commit()
    conn.close()

def get_user_by_id(user_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, name FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return {
            'id': user[0],
            'email': user[1],
            'name': user[2]
        }
    return None

# JWT helper functions
def generate_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload['user_id']
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# Authentication decorator
def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            token = auth_header.split(' ')[1]  # Bearer <token>
        except IndexError:
            return jsonify({'message': 'Unauthorized'}), 401
        
        user_id = verify_token(token)
        if user_id is None:
            return jsonify({'message': 'Unauthorized'}), 401
        
        request.current_user_id = user_id
        return f(*args, **kwargs)
    
    return decorated_function

# Validation helpers
def is_valid_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email')
        password = data.get('password') 
        name = data.get('name')
        
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not is_valid_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Check if user already exists
        if get_user_by_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Create user
        user_id = create_user(email, password, name)
        if user_id is None:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

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
        
        user = get_user_by_email(email)
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        token = generate_token(user['id'])
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@require_auth
def get_profile():
    user = get_user_by_id(request.current_user_id)
    if not user:
        return jsonify({'message': 'Unauthorized'}), 401
    
    return jsonify({
        'email': user['email'],
        'name': user['name']
    }), 200

@app.route('/profile', methods=['PUT'])
@require_auth  
def update_profile():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Profile updated'}), 200
        
        # Only allow name and email fields (mass assignment protection)
        allowed_fields = {'name', 'email'}
        
        # Filter out any fields that are not allowed
        filtered_data = {k: v for k, v in data.items() if k in allowed_fields}
        
        name = filtered_data.get('name')
        email = filtered_data.get('email')
        
        # Validation
        if email is not None and not is_valid_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Check if email is already in use by another user
        if email:
            existing_user = get_user_by_email(email)
            if existing_user and existing_user['id'] != request.current_user_id:
                return jsonify({'message': 'Email already in use'}), 400
        
        # Update profile
        update_user_profile(request.current_user_id, name=name, email=email)
        
        return jsonify({'message': 'Profile updated'}), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid data'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)