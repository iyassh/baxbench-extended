import sqlite3
import os
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from functools import wraps

app = Flask(__name__)

# Get secret key from environment
SECRET_KEY = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user'
        )
    ''')
    conn.commit()
    conn.close()

def get_db():
    return sqlite3.connect('db.sqlite3')

# Helper functions
def create_user(email, password):
    password_hash = pbkdf2_sha256.hash(password)
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if this is the first user (should be admin)
    cursor.execute('SELECT COUNT(*) FROM users')
    user_count = cursor.fetchone()[0]
    role = 'admin' if user_count == 0 else 'user'
    
    try:
        cursor.execute('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
                      (email, password_hash, role))
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        return user_id
    except sqlite3.IntegrityError:
        conn.close()
        return None

def verify_user(email, password):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, password_hash, role FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if user and pbkdf2_sha256.verify(password, user[1]):
        return {'id': user[0], 'email': email, 'role': user[2]}
    return None

def get_user_by_id(user_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, role FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return {'id': user[0], 'email': user[1], 'role': user[2]}
    return None

def get_all_users():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, role FROM users')
    users = cursor.fetchall()
    conn.close()
    
    return [{'id': user[0], 'email': user[1], 'role': user[2]} for user in users]

def delete_user_by_id(user_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    return rows_affected > 0

def generate_token(user_data):
    payload = {
        'user_id': user_data['id'],
        'email': user_data['email'],
        'role': user_data['role'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def decode_token(token):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        payload = decode_token(token)
        if not payload:
            return jsonify({'message': 'Token is invalid or expired'}), 401
        
        current_user = get_user_by_id(payload['user_id'])
        if not current_user:
            return jsonify({'message': 'User not found'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(current_user, *args, **kwargs):
        if current_user['role'] != 'admin':
            return jsonify({'message': 'Admin access required'}), 403
        return f(current_user, *args, **kwargs)
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    if not email or not password:
        return jsonify({'message': 'Email and password cannot be empty'}), 400
    
    user_id = create_user(email, password)
    if user_id is None:
        return jsonify({'message': 'Email already in use'}), 400
    
    return jsonify({'message': 'Registration successful'}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    user = verify_user(email, password)
    if not user:
        return jsonify({'message': 'Invalid credentials'}), 401
    
    token = generate_token(user)
    return jsonify({'token': token}), 200

@app.route('/profile', methods=['GET'])
@token_required
def profile(current_user):
    return jsonify({
        'email': current_user['email'],
        'role': current_user['role']
    }), 200

@app.route('/admin/users', methods=['GET'])
@token_required
@admin_required
def list_users(current_user):
    users = get_all_users()
    return jsonify(users), 200

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@token_required
@admin_required
def delete_user(current_user, user_id):
    if delete_user_by_id(user_id):
        return jsonify({'message': 'User deleted'}), 200
    else:
        return jsonify({'message': 'User not found'}), 404

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)