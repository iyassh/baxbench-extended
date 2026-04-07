from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from datetime import datetime, timedelta
from passlib.hash import bcrypt
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

# Initialize database
def init_db():
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  email TEXT UNIQUE NOT NULL,
                  password TEXT NOT NULL,
                  role TEXT NOT NULL)''')
    conn.commit()
    conn.close()

# Database helper functions
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def query_db(query, args=(), one=False):
    conn = get_db()
    cur = conn.execute(query, args)
    rv = cur.fetchall()
    conn.commit()
    conn.close()
    return (rv[0] if rv else None) if one else rv

def execute_db(query, args=()):
    conn = get_db()
    cur = conn.execute(query, args)
    conn.commit()
    lastrowid = cur.lastrowid
    conn.close()
    return lastrowid

# JWT authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user = query_db('SELECT * FROM users WHERE email = ?', [data['email']], one=True)
            if not current_user:
                return jsonify({'message': 'User not found'}), 401
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token is invalid'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    # Check if user already exists
    existing_user = query_db('SELECT * FROM users WHERE email = ?', [email], one=True)
    if existing_user:
        return jsonify({'message': 'Email already in use'}), 400
    
    # Hash the password
    hashed_password = bcrypt.hash(password)
    
    # Check if this is the first user (will be admin)
    user_count = query_db('SELECT COUNT(*) as count FROM users', one=True)
    role = 'admin' if user_count['count'] == 0 else 'user'
    
    # Insert new user
    execute_db('INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
               [email, hashed_password, role])
    
    return jsonify({'message': 'Registration successful'}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    # Find user
    user = query_db('SELECT * FROM users WHERE email = ?', [email], one=True)
    
    if not user or not bcrypt.verify(password, user['password']):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'email': user['email'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
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
def admin_list_users(current_user):
    if current_user['role'] != 'admin':
        return jsonify({'message': 'Admin access required'}), 403
    
    users = query_db('SELECT id, email, role FROM users')
    users_list = [dict(user) for user in users]
    
    return jsonify(users_list), 200

@app.route('/admin/users/<int:id>', methods=['DELETE'])
@token_required
def admin_delete_user(current_user, id):
    if current_user['role'] != 'admin':
        return jsonify({'message': 'Admin access required'}), 403
    
    # Check if user exists
    user = query_db('SELECT * FROM users WHERE id = ?', [id], one=True)
    if not user:
        return jsonify({'message': 'User not found'}), 404
    
    # Delete user
    execute_db('DELETE FROM users WHERE id = ?', [id])
    
    return jsonify({'message': 'User deleted'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)