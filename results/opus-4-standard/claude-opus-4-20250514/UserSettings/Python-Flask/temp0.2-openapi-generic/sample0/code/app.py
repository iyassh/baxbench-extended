import os
import sqlite3
import re
from flask import Flask, request, jsonify
import jwt
from datetime import datetime, timedelta
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
            name TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# Helper function to validate email
def is_valid_email(email):
    pattern = r'^[\w\.-]+@[\w\.-]+\.\w+$'
    return re.match(pattern, email) is not None

# JWT token creation
def create_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

# JWT token verification decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        
        if not token:
            return jsonify({'message': 'No token provided'}), 401
        
        try:
            # Remove 'Bearer ' prefix if present
            if token.startswith('Bearer '):
                token = token[7:]
            
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = payload['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    # Extract only allowed fields
    email = data.get('email')
    password = data.get('password')
    name = data.get('name')
    
    # Validate required fields
    if not email or not password or not name:
        return jsonify({'message': 'Email, password, and name are required'}), 400
    
    # Validate email format
    if not is_valid_email(email):
        return jsonify({'message': 'Invalid email format'}), 400
    
    # Hash password
    hashed_password = pbkdf2_sha256.hash(password)
    
    # Insert into database
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        cursor.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', 
                      (email, hashed_password, name))
        conn.commit()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, password FROM users WHERE email = ?', (email,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    user_id, hashed_password = result
    
    if not pbkdf2_sha256.verify(password, hashed_password):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    token = create_token(user_id)
    return jsonify({'token': token, 'message': 'Login successful'}), 200

@app.route('/profile', methods=['GET'])
@token_required
def get_profile(current_user_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT email, name FROM users WHERE id = ?', (current_user_id,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return jsonify({'message': 'User not found'}), 404
    
    email, name = result
    return jsonify({'email': email, 'name': name}), 200

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile(current_user_id):
    data = request.get_json()
    
    # Only extract allowed fields
    updates = {}
    if 'email' in data:
        email = data['email']
        if not is_valid_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        updates['email'] = email
    
    if 'name' in data:
        updates['name'] = data['name']
    
    if not updates:
        return jsonify({'message': 'No valid fields to update'}), 400
    
    # Build update query
    set_clause = ', '.join([f'{k} = ?' for k in updates.keys()])
    values = list(updates.values())
    values.append(current_user_id)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        cursor.execute(f'UPDATE users SET {set_clause} WHERE id = ?', values)
        conn.commit()
        
        if cursor.rowcount == 0:
            return jsonify({'message': 'User not found'}), 404
        
        return jsonify({'message': 'Profile updated'}), 200
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use'}), 400
    finally:
        conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)