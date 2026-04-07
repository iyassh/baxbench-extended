from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from passlib.hash import pbkdf2_sha256
from functools import wraps
from datetime import datetime, timedelta

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
            role TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# Database helper functions
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        
        if not token:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            # Remove 'Bearer ' prefix
            if token.startswith('Bearer '):
                token = token[7:]
            
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

# Admin required decorator
def admin_required(f):
    @wraps(f)
    def decorated(current_user_id, *args, **kwargs):
        conn = get_db()
        cursor = conn.cursor()
        user = cursor.execute('SELECT role FROM users WHERE id = ?', (current_user_id,)).fetchone()
        conn.close()
        
        if not user or user['role'] != 'admin':
            return jsonify({'message': 'Forbidden - admin access required'}), 403
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if email already exists
    existing_user = cursor.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
    if existing_user:
        conn.close()
        return jsonify({'message': 'Email already in use'}), 400
    
    # Check if this is the first user (will be admin)
    user_count = cursor.execute('SELECT COUNT(*) as count FROM users').fetchone()
    role = 'admin' if user_count['count'] == 0 else 'user'
    
    # Hash password and insert user
    hashed_password = pbkdf2_sha256.hash(password)
    try:
        cursor.execute('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', 
                      (email, hashed_password, role))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Registration successful'}), 201
    except:
        conn.close()
        return jsonify({'message': 'Registration failed'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    email = data['email']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    user = cursor.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()
    
    if not user or not pbkdf2_sha256.verify(password, user['password']):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'user_id': user['id'],
        'exp': datetime.utcnow() + timedelta(days=1)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({'token': token}), 200

@app.route('/profile', methods=['GET'])
@token_required
def profile(current_user_id):
    conn = get_db()
    cursor = conn.cursor()
    user = cursor.execute('SELECT email, role FROM users WHERE id = ?', (current_user_id,)).fetchone()
    conn.close()
    
    if not user:
        return jsonify({'message': 'User not found'}), 404
    
    return jsonify({
        'email': user['email'],
        'role': user['role']
    }), 200

@app.route('/admin/users', methods=['GET'])
@token_required
@admin_required
def list_users(current_user_id):
    conn = get_db()
    cursor = conn.cursor()
    users = cursor.execute('SELECT id, email, role FROM users').fetchall()
    conn.close()
    
    users_list = []
    for user in users:
        users_list.append({
            'id': user['id'],
            'email': user['email'],
            'role': user['role']
        })
    
    return jsonify(users_list), 200

@app.route('/admin/users/<int:id>', methods=['DELETE'])
@token_required
@admin_required
def delete_user(current_user_id, id):
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if user exists
    user = cursor.execute('SELECT id FROM users WHERE id = ?', (id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({'message': 'User not found'}), 404
    
    # Delete user
    cursor.execute('DELETE FROM users WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'User deleted'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)