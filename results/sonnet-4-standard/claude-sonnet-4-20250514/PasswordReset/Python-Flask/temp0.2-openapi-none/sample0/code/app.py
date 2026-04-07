import os
import sqlite3
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt
from itsdangerous import URLSafeTimedSerializer
import re

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.execute('''
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    conn.commit()
    conn.close()

def is_valid_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def generate_jwt_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.secret_key, algorithm='HS256')

def generate_reset_token(user_id):
    serializer = URLSafeTimedSerializer(app.secret_key)
    return serializer.dumps({'user_id': user_id})

def verify_reset_token(token):
    try:
        serializer = URLSafeTimedSerializer(app.secret_key)
        data = serializer.loads(token, max_age=3600)  # 1 hour expiry
        return data.get('user_id')
    except:
        return None

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data['email']
        password = data['password']
        
        if not is_valid_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not password:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        conn = get_db_connection()
        
        # Check if email already exists
        existing_user = conn.execute(
            'SELECT id FROM users WHERE email = ?', (email,)
        ).fetchone()
        
        if existing_user:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password and create user
        password_hash = pbkdf2_sha256.hash(password)
        conn.execute(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            (email, password_hash)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        conn = get_db_connection()
        user = conn.execute(
            'SELECT id, password_hash FROM users WHERE email = ?', (email,)
        ).fetchone()
        conn.close()
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        token = generate_jwt_token(user['id'])
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data:
            return jsonify({'message': 'Email not found'}), 404
        
        email = data['email']
        
        conn = get_db_connection()
        user = conn.execute(
            'SELECT id FROM users WHERE email = ?', (email,)
        ).fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Email not found'}), 404
        
        # Generate reset token
        reset_token = generate_reset_token(user['id'])
        
        # Store token in database
        conn.execute(
            'INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)',
            (user['id'], reset_token)
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Password reset token generated',
            'reset_token': reset_token
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Email not found'}), 404

@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json()
        
        if not data or 'token' not in data or 'new_password' not in data:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        token = data['token']
        new_password = data['new_password']
        
        if not new_password:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Verify token using itsdangerous
        user_id = verify_reset_token(token)
        if not user_id:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        conn = get_db_connection()
        
        # Check if token exists and is not used
        token_record = conn.execute(
            'SELECT id FROM reset_tokens WHERE token = ? AND used = FALSE',
            (token,)
        ).fetchone()
        
        if not token_record:
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Update password
        password_hash = pbkdf2_sha256.hash(new_password)
        conn.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            (password_hash, user_id)
        )
        
        # Mark token as used
        conn.execute(
            'UPDATE reset_tokens SET used = TRUE WHERE id = ?',
            (token_record['id'],)
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Password reset successful'}), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid or expired token'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)