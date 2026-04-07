from flask import Flask, request, jsonify
import sqlite3
import os
import json
from passlib.hash import bcrypt
import jwt
from datetime import datetime, timedelta
import secrets
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')
DATABASE = 'db.sqlite3'

# Initialize database
def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create reset tokens table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT 0,
            FOREIGN KEY (email) REFERENCES users(email)
        )
    ''')
    
    conn.commit()
    conn.close()

# Database helper functions
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def validate_email(email):
    pattern = r'^[\w\.-]+@[\w\.-]+\.\w+$'
    return re.match(pattern, email)

def validate_password(password):
    return len(password) >= 8

# Generate JWT token
def generate_jwt_token(email):
    payload = {
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

# Generate reset token
def generate_reset_token():
    return secrets.token_urlsafe(32)

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Email and password are required'}), 400
        
        email = data['email']
        password = data['password']
        
        # Validate email format
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Validate password strength
        if not validate_password(password):
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        # Hash password
        hashed_password = bcrypt.hash(password)
        
        # Insert user into database
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password) VALUES (?, ?)',
                (email, hashed_password)
            )
            conn.commit()
            conn.close()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
    except Exception as e:
        return jsonify({'message': 'Invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Email and password are required'}), 401
        
        email = data['email']
        password = data['password']
        
        # Get user from database
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not bcrypt.verify(password, user['password']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = generate_jwt_token(email)
        
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
            return jsonify({'message': 'Email is required'}), 400
        
        email = data['email']
        
        # Check if user exists
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Email not found'}), 404
        
        # Generate reset token
        reset_token = generate_reset_token()
        
        # Store reset token in database
        cursor.execute(
            'INSERT INTO reset_tokens (email, token) VALUES (?, ?)',
            (email, reset_token)
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Password reset token generated',
            'reset_token': reset_token
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Error processing request'}), 500

@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json()
        
        if not data or 'token' not in data or 'new_password' not in data:
            return jsonify({'message': 'Token and new password are required'}), 400
        
        token = data['token']
        new_password = data['new_password']
        
        # Validate new password
        if not validate_password(new_password):
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if token exists and is valid
        cursor.execute(
            '''SELECT * FROM reset_tokens 
               WHERE token = ? 
               AND used = 0 
               AND datetime(created_at, '+1 hour') > datetime('now')''',
            (token,)
        )
        reset_token = cursor.fetchone()
        
        if not reset_token:
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Hash new password
        hashed_password = bcrypt.hash(new_password)
        
        # Update user password
        cursor.execute(
            'UPDATE users SET password = ? WHERE email = ?',
            (hashed_password, reset_token['email'])
        )
        
        # Mark token as used
        cursor.execute(
            'UPDATE reset_tokens SET used = 1 WHERE token = ?',
            (token,)
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Password reset successful'}), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid or expired token'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)