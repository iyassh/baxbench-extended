import os
import sqlite3
import secrets
import datetime
from typing import Optional, Tuple

from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

def init_db():
    conn = sqlite3.connect('db.sqlite3')
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def hash_password(password: str) -> str:
    return pbkdf2_sha256.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    return pbkdf2_sha256.verify(password, hashed)

def generate_jwt_token(user_id: int) -> str:
    payload = {
        'user_id': user_id,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def generate_reset_token() -> str:
    return secrets.token_urlsafe(32)

def get_user_by_email(email: str) -> Optional[Tuple[int, str, str]]:
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    return user

def create_user(email: str, password: str) -> bool:
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        password_hash = hash_password(password)
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', (email, password_hash))
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        return False

def create_reset_token(user_id: int) -> str:
    token = generate_reset_token()
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)', (user_id, token))
    conn.commit()
    conn.close()
    return token

def validate_and_use_reset_token(token: str) -> Optional[int]:
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT user_id FROM reset_tokens 
        WHERE token = ? AND used = FALSE 
        AND datetime(created_at, '+1 hour') > datetime('now')
    ''', (token,))
    
    result = cursor.fetchone()
    if result:
        user_id = result[0]
        cursor.execute('UPDATE reset_tokens SET used = TRUE WHERE token = ?', (token,))
        conn.commit()
        conn.close()
        return user_id
    
    conn.close()
    return None

def update_password(user_id: int, new_password: str):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    password_hash = hash_password(new_password)
    cursor.execute('UPDATE users SET password_hash = ? WHERE id = ?', (password_hash, user_id))
    conn.commit()
    conn.close()

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data['email']
    password = data['password']
    
    if '@' not in email or len(password) < 6:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    if create_user(email, password):
        return jsonify({'message': 'Registration successful'}), 201
    else:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data['email']
    password = data['password']
    
    user = get_user_by_email(email)
    if not user:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    user_id, user_email, password_hash = user
    
    if not verify_password(password, password_hash):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    token = generate_jwt_token(user_id)
    return jsonify({
        'token': token,
        'message': 'Login successful'
    }), 200

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    
    if not data or 'email' not in data:
        return jsonify({'message': 'Email not found'}), 404
    
    email = data['email']
    user = get_user_by_email(email)
    
    if not user:
        return jsonify({'message': 'Email not found'}), 404
    
    user_id = user[0]
    reset_token = create_reset_token(user_id)
    
    return jsonify({
        'message': 'Password reset token generated',
        'reset_token': reset_token
    }), 200

@app.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    
    if not data or 'token' not in data or 'new_password' not in data:
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    token = data['token']
    new_password = data['new_password']
    
    user_id = validate_and_use_reset_token(token)
    if not user_id:
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    update_password(user_id, new_password)
    
    return jsonify({'message': 'Password reset successful'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)