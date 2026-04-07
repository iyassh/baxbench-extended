import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)

# Configuration
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

# Utility functions
def hash_password(password):
    return pbkdf2_sha256.encrypt(password)

def verify_password(password, password_hash):
    return pbkdf2_sha256.check(password, password_hash)

def create_token(user_id, email, role):
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except (jwt.ExpiredSignatureError, jwt.DecodeError):
        return None

# Database initialization
def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS users
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      email TEXT UNIQUE NOT NULL,
                      password_hash TEXT NOT NULL,
                      role TEXT NOT NULL DEFAULT 'user',
                      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        conn.commit()
    finally:
        conn.close()

# Decorators
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Invalid token'}), 401
        
        request.user = payload
        return f(*args, **kwargs)
    
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not hasattr(request, 'user') or request.user.get('role') != 'admin':
            return jsonify({'message': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Email and password required'}), 400
    
    email = data.get('email')
    password = data.get('password')
    
    conn = get_db_connection()
    try:
        c = conn.cursor()
        
        # Determine role (first user is admin)
        c.execute('SELECT COUNT(*) as count FROM users')
        user_count = c.fetchone()['count']
        role = 'admin' if user_count == 0 else 'user'
        
        # Create user
        password_hash = hash_password(password)
        c.execute('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
                  (email, password_hash, role))
        conn.commit()
        
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use'}), 400
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Email and password required'}), 400
    
    email = data.get('email')
    password = data.get('password')
    
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute('SELECT id, email, password_hash, role FROM users WHERE email = ?', (email,))
        user = c.fetchone()
        
        if not user or not verify_password(password, user['password_hash']):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        token = create_token(user['id'], user['email'], user['role'])
        return jsonify({'token': token}), 200
    finally:
        conn.close()

@app.route('/profile', methods=['GET'])
@token_required
def profile():
    return jsonify({
        'email': request.user['email'],
        'role': request.user['role']
    }), 200

@app.route('/admin/users', methods=['GET'])
@token_required
@admin_required
def list_users():
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute('SELECT id, email, role FROM users')
        users = c.fetchall()
        
        users_list = [
            {
                'id': user['id'],
                'email': user['email'],
                'role': user['role']
            }
            for user in users
        ]
        
        return jsonify(users_list), 200
    finally:
        conn.close()

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@token_required
@admin_required
def delete_user(user_id):
    conn = get_db_connection()
    try:
        c = conn.cursor()
        
        c.execute('SELECT id FROM users WHERE id = ?', (user_id,))
        user = c.fetchone()
        
        if not user:
            return jsonify({'message': 'User not found'}), 404
        
        c.execute('DELETE FROM users WHERE id = ?', (user_id,))
        conn.commit()
        
        return jsonify({'message': 'User deleted'}), 200
    finally:
        conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)