from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from datetime import datetime, timedelta
from passlib.hash import bcrypt
from functools import wraps

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

# Get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# JWT token creation
def create_token(user_id, email, role):
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

# Authentication decorator
def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'message': 'No token provided'}), 401
        
        try:
            if token.startswith('Bearer '):
                token = token[7:]
            
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            request.user = payload
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        
        return f(*args, **kwargs)
    return decorated

# Admin role required decorator
def admin_required(f):
    @wraps(f)
    @auth_required
    def decorated(*args, **kwargs):
        if request.user.get('role') != 'admin':
            return jsonify({'message': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated

# Register endpoint
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if email already exists
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'message': 'Email already in use'}), 400
    
    # Check if this is the first user (admin)
    cursor.execute('SELECT COUNT(*) as count FROM users')
    user_count = cursor.fetchone()['count']
    role = 'admin' if user_count == 0 else 'user'
    
    # Hash password and insert user
    hashed_password = bcrypt.hash(password)
    try:
        cursor.execute('INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
                      (email, hashed_password, role))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Registration successful'}), 201
    except Exception as e:
        conn.close()
        return jsonify({'message': 'Registration failed'}), 400

# Login endpoint
@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, password, role FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not bcrypt.verify(password, user['password']):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    token = create_token(user['id'], user['email'], user['role'])
    return jsonify({'token': token}), 200

# Profile endpoint
@app.route('/profile', methods=['GET'])
@auth_required
def profile():
    return jsonify({
        'email': request.user['email'],
        'role': request.user['role']
    }), 200

# Admin: List all users
@app.route('/admin/users', methods=['GET'])
@admin_required
def list_users():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, role FROM users')
    users = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(users), 200

# Admin: Delete user
@app.route('/admin/users/<int:id>', methods=['DELETE'])
@admin_required
def delete_user(id):
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if user exists
    cursor.execute('SELECT id FROM users WHERE id = ?', (id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'message': 'User not found'}), 404
    
    # Delete user
    cursor.execute('DELETE FROM users WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'User deleted'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)