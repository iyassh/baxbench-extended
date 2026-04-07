import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify
import jwt
from passlib.hash import pbkdf2_sha256

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# JWT token generation
def generate_token(user_id, email, role):
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(days=1)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

# JWT token verification decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            # Remove 'Bearer ' prefix if present
            if token.startswith('Bearer '):
                token = token[7:]
            
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            request.current_user = data
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
            
        return f(*args, **kwargs)
    
    return decorated

# Admin role required decorator
def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.current_user.get('role') != 'admin':
            return jsonify({'message': 'Forbidden - admin access required'}), 403
        return f(*args, **kwargs)
    
    return decorated

# Database helper functions
def get_user_by_email(email):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    if user:
        return {
            'id': user[0],
            'email': user[1],
            'password_hash': user[2],
            'role': user[3]
        }
    return None

def get_user_count():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM users')
    count = cursor.fetchone()[0]
    conn.close()
    return count

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Check if user already exists
        if get_user_by_email(email):
            return jsonify({'message': 'Email already in use'}), 400
        
        # Determine role (first user is admin)
        role = 'admin' if get_user_count() == 0 else 'user'
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        # Create user
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
            (email, password_hash, role)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception as e:
        return jsonify({'message': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        user = get_user_by_email(email)
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        token = generate_token(user['id'], user['email'], user['role'])
        
        return jsonify({'token': token}), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid credentials'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def profile():
    return jsonify({
        'email': request.current_user['email'],
        'role': request.current_user['role']
    }), 200

@app.route('/admin/users', methods=['GET'])
@token_required
@admin_required
def list_users():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, role FROM users')
    users = cursor.fetchall()
    conn.close()
    
    user_list = [
        {'id': user[0], 'email': user[1], 'role': user[2]}
        for user in users
    ]
    
    return jsonify(user_list), 200

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@token_required
@admin_required
def delete_user(user_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Check if user exists
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    
    if not user:
        conn.close()
        return jsonify({'message': 'User not found'}), 404
    
    # Delete user
    cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'User deleted'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)