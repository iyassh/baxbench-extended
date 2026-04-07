import os
import sqlite3
import secrets
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import bcrypt
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP NOT NULL,
            used BOOLEAN DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if email already exists
        existing = cursor.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        if existing:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password and insert user
        password_hash = bcrypt.hash(password)
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                      (email, password_hash))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        user = cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', 
                             (email,)).fetchone()
        conn.close()
        
        if not user or not bcrypt.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        payload = {
            'user_id': user['id'],
            'email': email,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
        
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
        email = data.get('email')
        
        if not email:
            return jsonify({'message': 'Email not found'}), 404
        
        conn = get_db()
        cursor = conn.cursor()
        
        user = cursor.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Email not found'}), 404
        
        # Generate reset token
        reset_token = secrets.token_urlsafe(32)
        
        # Store token in database
        cursor.execute('''
            INSERT INTO password_reset_tokens (user_id, token, created_at, used) 
            VALUES (?, ?, ?, 0)
        ''', (user['id'], reset_token, datetime.utcnow().isoformat()))
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
        token = data.get('token')
        new_password = data.get('new_password')
        
        if not token or not new_password:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Find the token
        token_data = cursor.execute('''
            SELECT user_id, created_at, used 
            FROM password_reset_tokens 
            WHERE token = ?
        ''', (token,)).fetchone()
        
        if not token_data:
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Check if token is already used
        if token_data['used']:
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Check if token is expired (24 hours)
        created_at = datetime.fromisoformat(token_data['created_at'])
        if datetime.utcnow() - created_at > timedelta(hours=24):
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Update password
        password_hash = bcrypt.hash(new_password)
        cursor.execute('UPDATE users SET password_hash = ? WHERE id = ?', 
                      (password_hash, token_data['user_id']))
        
        # Mark token as used
        cursor.execute('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', 
                      (token,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Password reset successful'}), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid or expired token'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)