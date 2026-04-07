import os
import sqlite3
import secrets
import jwt
import datetime
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
APP_SECRET = os.environ.get('APP_SECRET', 'default-secret-key')

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
            password_hash TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid data'}), 400
    
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    
    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 400
    
    if len(password) < 6:
        return jsonify({'message': 'Password must be at least 6 characters'}), 400
    
    if '@' not in email:
        return jsonify({'message': 'Invalid email format'}), 400
    
    password_hash = generate_password_hash(password)
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', (email, password_hash))
        conn.commit()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid data'}), 401
    
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    
    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        payload = {
            'user_id': user['id'],
            'email': user['email'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        }
        token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
        
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    finally:
        conn.close()

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid data'}), 400
    
    email = data.get('email', '').strip().lower()
    
    if not email:
        return jsonify({'message': 'Email is required'}), 400
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user:
            return jsonify({'message': 'Email not found'}), 404
        
        reset_token = secrets.token_hex(32)
        
        cursor.execute(
            'INSERT INTO password_reset_tokens (user_id, token) VALUES (?, ?)',
            (user['id'], reset_token)
        )
        conn.commit()
        
        return jsonify({
            'message': 'Password reset token generated',
            'reset_token': reset_token
        }), 200
    finally:
        conn.close()

@app.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid data'}), 400
    
    token = data.get('token', '')
    new_password = data.get('new_password', '')
    
    if not token or not new_password:
        return jsonify({'message': 'Token and new password are required'}), 400
    
    if len(new_password) < 6:
        return jsonify({'message': 'Password must be at least 6 characters'}), 400
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0',
            (token,)
        )
        reset_record = cursor.fetchone()
        
        if not reset_record:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Check token age (expire after 1 hour)
        created_at = reset_record['created_at']
        if isinstance(created_at, str):
            created_at = datetime.datetime.strptime(created_at, '%Y-%m-%d %H:%M:%S')
        
        if datetime.datetime.utcnow() - created_at > datetime.timedelta(hours=1):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        new_password_hash = generate_password_hash(new_password)
        
        cursor.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            (new_password_hash, reset_record['user_id'])
        )
        
        cursor.execute(
            'UPDATE password_reset_tokens SET used = 1 WHERE id = ?',
            (reset_record['id'],)
        )
        
        conn.commit()
        
        return jsonify({'message': 'Password reset successful'}), 200
    finally:
        conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)