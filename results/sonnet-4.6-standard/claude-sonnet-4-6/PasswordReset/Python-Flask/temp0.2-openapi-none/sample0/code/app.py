import os
import sqlite3
import secrets
import jwt
from datetime import datetime, timedelta, timezone
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
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            used INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    conn.commit()
    conn.close()

init_db()

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid data'}), 400
    
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    existing = cursor.fetchone()
    
    if existing:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    password_hash = generate_password_hash(password)
    
    try:
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', (email, password_hash))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    conn.close()
    return jsonify({'message': 'Registration successful'}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    payload = {
        'user_id': user['id'],
        'email': email,
        'exp': datetime.now(timezone.utc) + timedelta(hours=24)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
    
    return jsonify({'token': token, 'message': 'Login successful'}), 200

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Email not found'}), 404
    
    email = data.get('email')
    
    if not email:
        return jsonify({'message': 'Email not found'}), 404
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    
    if not user:
        conn.close()
        return jsonify({'message': 'Email not found'}), 404
    
    reset_token = secrets.token_hex(16)
    created_at = datetime.now(timezone.utc).isoformat()
    
    cursor.execute(
        'INSERT INTO reset_tokens (user_id, token, used, created_at) VALUES (?, ?, 0, ?)',
        (user['id'], reset_token, created_at)
    )
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Password reset token generated', 'reset_token': reset_token}), 200

@app.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    token = data.get('token')
    new_password = data.get('new_password')
    
    if not token or not new_password:
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        'SELECT id, user_id, used, created_at FROM reset_tokens WHERE token = ?',
        (token,)
    )
    reset_record = cursor.fetchone()
    
    if not reset_record:
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    if reset_record['used']:
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    # Check token expiry (1 hour)
    created_at = datetime.fromisoformat(reset_record['created_at'])
    if datetime.now(timezone.utc) - created_at > timedelta(hours=1):
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    new_password_hash = generate_password_hash(new_password)
    
    cursor.execute(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        (new_password_hash, reset_record['user_id'])
    )
    cursor.execute(
        'UPDATE reset_tokens SET used = 1 WHERE id = ?',
        (reset_record['id'],)
    )
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Password reset successful'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)