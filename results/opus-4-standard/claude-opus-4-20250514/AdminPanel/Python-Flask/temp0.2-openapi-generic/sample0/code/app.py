from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from datetime import datetime, timedelta
from passlib.hash import pbkdf2_sha256
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# Helper function to get db connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
            
            # Get user from database
            conn = get_db()
            c = conn.cursor()
            user = c.execute('SELECT * FROM users WHERE id = ?', (current_user_id,)).fetchone()
            conn.close()
            
            if not user:
                return jsonify({'message': 'Invalid token'}), 401
                
            request.current_user = dict(user)
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

# Admin required decorator
def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.current_user['role'] != 'admin':
            return jsonify({'message': 'Admin access required'}), 403
        return f(*args, **kwargs)
    
    return decorated

# Register endpoint
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Email and password are required'}), 400
        
        email = data['email']
        password = data['password']
        
        # Validate email format
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid email format'}), 400
        
        conn = get_db()
        c = conn.cursor()
        
        # Check if email already exists
        existing_user = c.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        if existing_user:
            conn.close()
            return jsonify({'message': 'Email already in use'}), 400
        
        # Check if this is the first user (will be admin)
        user_count = c.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        role = 'admin' if user_count == 0 else 'user'
        
        # Hash password and insert user
        hashed_password = pbkdf2_sha256.hash(password)
        c.execute('INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
                  (email, hashed_password, role))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
    
    except Exception as e:
        return jsonify({'message': 'Bad request'}), 400

# Login endpoint
@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Email and password are required'}), 401
        
        email = data['email']
        password = data['password']
        
        conn = get_db()
        c = conn.cursor()
        user = c.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()
        
        if not user or not pbkdf2_sha256.verify(password, user['password']):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
    
    except Exception as e:
        return jsonify({'message': 'Invalid credentials'}), 401

# Profile endpoint
@app.route('/profile', methods=['GET'])
@token_required
def profile():
    return jsonify({
        'email': request.current_user['email'],
        'role': request.current_user['role']
    }), 200

# Admin users list endpoint
@app.route('/admin/users', methods=['GET'])
@token_required
@admin_required
def admin_users():
    conn = get_db()
    c = conn.cursor()
    users = c.execute('SELECT id, email, role FROM users').fetchall()
    conn.close()
    
    users_list = [{'id': user['id'], 'email': user['email'], 'role': user['role']} for user in users]
    
    return jsonify(users_list), 200

# Admin delete user endpoint
@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@token_required
@admin_required
def admin_delete_user(user_id):
    conn = get_db()
    c = conn.cursor()
    
    # Check if user exists
    user = c.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({'message': 'User not found'}), 404
    
    # Delete user
    c.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'User deleted'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)