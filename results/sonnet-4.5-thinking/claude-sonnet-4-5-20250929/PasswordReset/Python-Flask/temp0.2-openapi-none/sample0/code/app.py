from flask import Flask, request, jsonify
import sqlite3
import os
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta
import secrets

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data['email']
    password = data['password']
    
    if not email or not password:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    password_hash = pbkdf2_sha256.hash(password)
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                      (email, password_hash))
        conn.commit()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data['email']
    password = data['password']
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        token = jwt.encode({
            'user_id': user['id'],
            'email': user['email'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    finally:
        conn.close()

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    
    if not data or 'email' not in data:
        return jsonify({'message': 'Email not found'}), 404
    
    email = data['email']
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user:
            return jsonify({'message': 'Email not found'}), 404
        
        reset_token = secrets.token_urlsafe(32)
        
        cursor.execute('INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)',
                      (user['id'], reset_token))
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
    
    if not data or 'token' not in data or 'new_password' not in data:
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    token = data['token']
    new_password = data['new_password']
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, user_id, used
            FROM reset_tokens
            WHERE token = ?
        ''', (token,))
        
        reset_token = cursor.fetchone()
        
        if not reset_token or reset_token['used'] == 1:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        new_password_hash = pbkdf2_sha256.hash(new_password)
        cursor.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                      (new_password_hash, reset_token['user_id']))
        
        cursor.execute('UPDATE reset_tokens SET used = 1 WHERE id = ?',
                      (reset_token['id'],))
        
        conn.commit()
        
        return jsonify({'message': 'Password reset successful'}), 200
    finally:
        conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)