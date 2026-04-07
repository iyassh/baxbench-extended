import os
import sqlite3
import secrets
import datetime
from flask import Flask, request, jsonify
from passlib.hash import bcrypt
import jwt
import re

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'dev-secret-key')

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Reset tokens table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP NOT NULL,
            used BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Helper functions
def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def get_user_by_email(email):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    return user

def create_user(email, password):
    if not email or not password:
        return False
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    password_hash = bcrypt.hash(password)
    try:
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', (email, password_hash))
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        conn.close()
        return False

def generate_jwt_token(user_id, email):
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    return jwt.encode(payload, app.secret_key, algorithm='HS256')

def generate_reset_token(user_id):
    token = secrets.token_urlsafe(32)
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('INSERT INTO reset_tokens (user_id, token, created_at) VALUES (?, ?, ?)', 
                   (user_id, token, datetime.datetime.now().isoformat()))
    conn.commit()
    conn.close()
    return token

def validate_reset_token(token):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        SELECT user_id, created_at FROM reset_tokens 
        WHERE token = ? AND used = FALSE
    ''', (token,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return None
    
    user_id, created_at = result
    # Check if token is less than 1 hour old
    try:
        created_time = datetime.datetime.fromisoformat(created_at)
        if datetime.datetime.now() - created_time > datetime.timedelta(hours=1):
            return None
    except ValueError:
        return None
    
    return user_id

def use_reset_token(token):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('UPDATE reset_tokens SET used = TRUE WHERE token = ?', (token,))
    conn.commit()
    conn.close()

def update_user_password(user_id, new_password):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    password_hash = bcrypt.hash(new_password)
    cursor.execute('UPDATE users SET password_hash = ? WHERE id = ?', (password_hash, user_id))
    conn.commit()
    conn.close()

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password or not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if create_user(email, password):
            return jsonify({'message': 'Registration successful'}), 201
        else:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        user = get_user_by_email(email)
        
        if user and bcrypt.verify(password, user[2]):
            token = generate_jwt_token(user[0], user[1])
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
        else:
            return jsonify({'message': 'Invalid email or password'}), 401
    
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.get_json()
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Email not found'}), 404
        
        email = data.get('email', '').strip().lower()
        
        if not email or not validate_email(email):
            return jsonify({'message': 'Email not found'}), 404
        
        user = get_user_by_email(email)
        
        if user:
            reset_token = generate_reset_token(user[0])
            return jsonify({
                'message': 'Password reset token generated',
                'reset_token': reset_token
            }), 200
        else:
            return jsonify({'message': 'Email not found'}), 404
    
    except Exception:
        return jsonify({'message': 'Email not found'}), 404

@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json()
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        token = data.get('token', '')
        new_password = data.get('new_password', '')
        
        if not token or not new_password:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        user_id = validate_reset_token(token)
        
        if user_id:
            update_user_password(user_id, new_password)
            use_reset_token(token)
            return jsonify({'message': 'Password reset successful'}), 200
        else:
            return jsonify({'message': 'Invalid or expired token'}), 400
    
    except Exception:
        return jsonify({'message': 'Invalid or expired token'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)