import os
import sqlite3
import secrets
import re
from datetime import datetime, timedelta
import jwt
from werkzeug.security import check_password_hash, generate_password_hash
from flask import Flask, request, jsonify

app = Flask(__name__)

SECRET_KEY = os.environ.get('APP_SECRET', 'dev-key')
DATABASE = 'db.sqlite3'
TOKEN_EXPIRY_MINUTES = 30

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    c.execute('''
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT 0
        )
    ''')
    
    conn.commit()
    conn.close()

@app.after_request
def security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def valid_email(email):
    return re.match(r'^[^@]+@[^@]+\.[^@]+$', email) is not None

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json() or {}
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        if not valid_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        if len(password) < 6:
            return jsonify({'message': 'Password is too short'}), 400
        
        conn = get_db()
        c = conn.cursor()
        
        try:
            c.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)',
                     (email, generate_password_hash(password)))
            conn.commit()
            conn.close()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use'}), 400
    
    except Exception as e:
        print(f"Registration error: {e}")
        return jsonify({'message': 'An error occurred'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json() or {}
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
        user = c.fetchone()
        conn.close()
        
        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, SECRET_KEY, algorithm='HS256')
        
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    
    except Exception as e:
        print(f"Login error: {e}")
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.get_json() or {}
        email = data.get('email', '').strip()
        
        if not email:
            return jsonify({'message': 'Email not found'}), 404
        
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT id FROM users WHERE email = ?', (email,))
        user = c.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Email not found'}), 404
        
        reset_token = secrets.token_urlsafe(32)
        c.execute('''
            INSERT INTO password_reset_tokens (user_id, token)
            VALUES (?, ?)
        ''', (user['id'], reset_token))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Password reset token generated',
            'reset_token': reset_token
        }), 200
    
    except Exception as e:
        print(f"Forgot password error: {e}")
        return jsonify({'message': 'Email not found'}), 404

@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json() or {}
        token = data.get('token', '').strip()
        new_password = data.get('new_password', '')
        
        if not token or not new_password:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        if len(new_password) < 6:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        conn = get_db()
        c = conn.cursor()
        
        c.execute('''
            SELECT id, user_id, created_at FROM password_reset_tokens 
            WHERE token = ? AND used = 0
        ''', (token,))
        
        token_row = c.fetchone()
        
        if not token_row:
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        created = datetime.strptime(token_row['created_at'], '%Y-%m-%d %H:%M:%S')
        if datetime.utcnow() - created > timedelta(minutes=TOKEN_EXPIRY_MINUTES):
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        c.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                 (generate_password_hash(new_password), token_row['user_id']))
        c.execute('UPDATE password_reset_tokens SET used = 1 WHERE id = ?',
                 (token_row['id'],))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Password reset successful'}), 200
    
    except Exception as e:
        print(f"Reset password error: {e}")
        return jsonify({'message': 'Invalid or expired token'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)