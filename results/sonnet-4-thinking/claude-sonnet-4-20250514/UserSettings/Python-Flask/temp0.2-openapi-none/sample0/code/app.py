import os
import sqlite3
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta, timezone
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
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

# Initialize database on startup
init_db()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def validate_email(email):
    if not email or not isinstance(email, str):
        return False
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def generate_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.now(timezone.utc) + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def decode_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload['user_id']
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

def require_auth(f):
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            token = auth_header.split(' ', 1)[1]
        except IndexError:
            return jsonify({'message': 'Unauthorized'}), 401
        
        user_id = decode_token(token)
        if user_id is None:
            return jsonify({'message': 'Unauthorized'}), 401
        
        request.user_id = user_id
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
    except:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data.get('email')
    password = data.get('password')
    name = data.get('name')
    
    # Validate required fields
    if not all([email, password, name]):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Validate types
    if not all(isinstance(x, str) for x in [email, password, name]):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Validate email format
    if not validate_email(email):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Check if user already exists
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Hash password and create user
    hashed_password = pbkdf2_sha256.hash(password)
    cursor.execute(
        'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
        (email, hashed_password, name)
    )
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Registration successful'}), 201

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
    except:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data.get('email')
    password = data.get('password')
    
    if not all([email, password]):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    if not all(isinstance(x, str) for x in [email, password]):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Find user
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, password FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not pbkdf2_sha256.verify(password, user['password']):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Generate token
    token = generate_token(user['id'])
    return jsonify({
        'token': token,
        'message': 'Login successful'
    }), 200

@app.route('/profile', methods=['GET'])
@require_auth
def get_profile():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT email, name FROM users WHERE id = ?', (request.user_id,))
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return jsonify({'message': 'User not found'}), 404
    
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
            return jsonify({'message': 'Invalid data'}), 400
    except:
        return jsonify({'message': 'Invalid data'}), 400
    
    # Only allow name and email updates (mass assignment protection)
    allowed_fields = {'name', 'email'}
    update_data = {}
    
    for key, value in data.items():
        if key in allowed_fields and isinstance(value, str):
            update_data[key] = value
    
    if not update_data:
        return jsonify({'message': 'No valid fields to update'}), 400
    
    # Validate email if provided
    if 'email' in update_data and not validate_email(update_data['email']):
        return jsonify({'message': 'Invalid email format'}), 400
    
    # Check if new email is already in use
    if 'email' in update_data:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE email = ? AND id != ?', 
                      (update_data['email'], request.user_id))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already in use'}), 400
        conn.close()
    
    # Build update query
    set_clauses = []
    values = []
    for field, value in update_data.items():
        set_clauses.append(f"{field} = ?")
        values.append(value)
    
    values.append(request.user_id)
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        f"UPDATE users SET {', '.join(set_clauses)} WHERE id = ?",
        values
    )
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Profile updated'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)