import os
import sqlite3
import jwt
from datetime import datetime, timedelta, timezone
from functools import wraps
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
SECRET_KEY = os.environ.get('APP_SECRET', 'default-secret-key')
DB_NAME = 'db.sqlite3'


def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user'
        )
    ''')
    conn.commit()
    conn.close()


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Unauthorized'}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        
        conn = get_db()
        user = conn.execute('SELECT * FROM users WHERE id = ?', (payload['user_id'],)).fetchone()
        conn.close()
        if not user:
            return jsonify({'message': 'Unauthorized'}), 401
        return f(user, *args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Unauthorized'}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        
        conn = get_db()
        user = conn.execute('SELECT * FROM users WHERE id = ?', (payload['user_id'],)).fetchone()
        conn.close()
        if not user:
            return jsonify({'message': 'Unauthorized'}), 401
        if user['role'] != 'admin':
            return jsonify({'message': 'Forbidden - admin access required'}), 403
        return f(user, *args, **kwargs)
    return decorated


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    if not email or not password:
        return jsonify({'message': 'Email and password cannot be empty'}), 400
    
    conn = get_db()
    existing = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
    if existing:
        conn.close()
        return jsonify({'message': 'Email already in use'}), 400
    
    count = conn.execute('SELECT COUNT(*) as cnt FROM users').fetchone()['cnt']
    role = 'admin' if count == 0 else 'user'
    
    hashed_password = generate_password_hash(password)
    conn.execute('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', (email, hashed_password, role))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Registration successful'}), 201


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()
    
    if not user or not check_password_hash(user['password'], password):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    payload = {
        'user_id': user['id'],
        'email': user['email'],
        'role': user['role'],
        'exp': datetime.now(timezone.utc) + timedelta(hours=24)
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')
    
    return jsonify({'token': token}), 200


@app.route('/profile', methods=['GET'])
@token_required
def profile(current_user):
    return jsonify({
        'email': current_user['email'],
        'role': current_user['role']
    }), 200


@app.route('/admin/users', methods=['GET'])
@admin_required
def list_users(current_user):
    conn = get_db()
    users = conn.execute('SELECT id, email, role FROM users').fetchall()
    conn.close()
    
    users_list = [{'id': u['id'], 'email': u['email'], 'role': u['role']} for u in users]
    return jsonify(users_list), 200


@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(current_user, user_id):
    conn = get_db()
    user = conn.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({'message': 'User not found'}), 404
    
    conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'User deleted'}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)