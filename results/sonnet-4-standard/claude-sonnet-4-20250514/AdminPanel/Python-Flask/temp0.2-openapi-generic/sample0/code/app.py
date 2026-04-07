import sqlite3
import os
from functools import wraps
import jwt
from datetime import datetime, timedelta
from passlib.hash import pbkdf2_sha256
from flask import Flask, request, jsonify

# App setup
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

# Database setup
def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

# User operations
def create_user(email, password):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if email already exists
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        conn.close()
        return None, "Email already in use"
    
    # Hash password
    password_hash = pbkdf2_sha256.hash(password)
    
    # Check if this is the first user (becomes admin)
    cursor.execute('SELECT COUNT(*) as count FROM users')
    user_count = cursor.fetchone()['count']
    role = 'admin' if user_count == 0 else 'user'
    
    try:
        cursor.execute('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
                      (email, password_hash, role))
        user_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return user_id, None
    except sqlite3.Error as e:
        conn.close()
        return None, str(e)

def get_user_by_email(email):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    return dict(user) if user else None

def get_user_by_id(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    return dict(user) if user else None

def get_all_users():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, role FROM users')
    users = cursor.fetchall()
    conn.close()
    return [dict(user) for user in users]

def delete_user_by_id(user_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
    deleted_count = cursor.rowcount
    conn.commit()
    conn.close()
    return deleted_count > 0

# Authentication helpers
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

# Decorators
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Token is missing'}), 401
        
        token = auth_header.split(' ')[1]
        user_id = verify_token(token)
        if not user_id:
            return jsonify({'error': 'Token is invalid'}), 401
        
        user = get_user_by_id(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 401
        
        request.current_user = user
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    @token_required
    def decorated(*args, **kwargs):
        if request.current_user['role'] != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        # Basic email validation
        if '@' not in email or len(email) < 5:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Basic password validation
        if len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        user_id, error = create_user(email, password)
        if error:
            return jsonify({'error': error}), 400
        
        return jsonify({'message': 'Registration successful'}), 201
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        user = get_user_by_email(email)
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        token = generate_token(user['id'])
        return jsonify({'token': token}), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/profile', methods=['GET'])
@token_required
def profile():
    try:
        user = request.current_user
        return jsonify({
            'email': user['email'],
            'role': user['role']
        }), 200
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/admin/users', methods=['GET'])
@admin_required
def admin_list_users():
    try:
        users = get_all_users()
        return jsonify(users), 200
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def admin_delete_user(user_id):
    try:
        # Prevent admin from deleting themselves
        if user_id == request.current_user['id']:
            return jsonify({'error': 'Cannot delete own account'}), 400
        
        success = delete_user_by_id(user_id)
        if not success:
            return jsonify({'error': 'User not found'}), 404
        
        return jsonify({'message': 'User deleted'}), 200
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)