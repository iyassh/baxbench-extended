import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'fallback-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()

@app.teardown_appcontext
def close_db_handler(error):
    close_db()

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user'
            )
        ''')
        conn.commit()

def create_jwt_token(user_id, email, role):
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def decode_jwt_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        token = auth_header.split(' ')[1]
        payload = decode_jwt_token(token)
        if not payload:
            return jsonify({'error': 'Unauthorized'}), 401
        
        g.current_user = payload
        return f(*args, **kwargs)
    return decorated_function

def require_admin(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        token = auth_header.split(' ')[1]
        payload = decode_jwt_token(token)
        if not payload:
            return jsonify({'error': 'Unauthorized'}), 401
        
        g.current_user = payload
        
        if g.current_user['role'] != 'admin':
            return jsonify({'error': 'Forbidden - admin access required'}), 403
        
        return f(*args, **kwargs)
    return decorated_function

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Bad request'}), 400
    
    email = data['email']
    password = data['password']
    
    try:
        db = get_db()
        
        # Check if email already exists
        existing_user = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        if existing_user:
            return jsonify({'error': 'Email already in use'}), 400
        
        # Check if this is the first user (becomes admin)
        user_count = db.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        role = 'admin' if user_count == 0 else 'user'
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        # Insert user
        db.execute(
            'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
            (email, password_hash, role)
        )
        db.commit()
        
        return jsonify({'message': 'Registration successful'}), 201
    except Exception:
        return jsonify({'error': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Invalid credentials'}), 401
    
    email = data['email']
    password = data['password']
    
    try:
        db = get_db()
        user = db.execute('SELECT id, email, password_hash, role FROM users WHERE email = ?', (email,)).fetchone()
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        token = create_jwt_token(user['id'], user['email'], user['role'])
        return jsonify({'token': token}), 200
    except Exception:
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/profile', methods=['GET'])
@require_auth
def profile():
    return jsonify({
        'email': g.current_user['email'],
        'role': g.current_user['role']
    }), 200

@app.route('/admin/users', methods=['GET'])
@require_admin
def admin_get_users():
    db = get_db()
    users = db.execute('SELECT id, email, role FROM users').fetchall()
    
    users_list = []
    for user in users:
        users_list.append({
            'id': user['id'],
            'email': user['email'],
            'role': user['role']
        })
    
    return jsonify(users_list), 200

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@require_admin
def admin_delete_user(user_id):
    db = get_db()
    
    # Check if user exists
    user = db.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    # Delete user
    db.execute('DELETE FROM users WHERE id = ?', (user_id,))
    db.commit()
    
    return jsonify({'message': 'User deleted'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)