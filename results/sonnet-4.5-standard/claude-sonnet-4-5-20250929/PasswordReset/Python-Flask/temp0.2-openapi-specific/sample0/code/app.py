from flask import Flask, request, jsonify
import sqlite3
import os
import secrets
from datetime import datetime, timedelta
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-me')

DATABASE = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def validate_email(email):
    if not email or '@' not in email or len(email) < 3:
        return False
    return True

def validate_password(password):
    if not password or len(password) < 8:
        return False
    return True

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password_hash) VALUES (?, ?)',
                (email, password_hash)
            )
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        token = jwt.encode(
            {
                'user_id': user['id'],
                'email': user['email'],
                'exp': datetime.utcnow() + timedelta(hours=24)
            },
            app.config['SECRET_KEY'],
            algorithm='HS256'
        )
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email not found'}), 404
        
        email = data.get('email', '').strip().lower()
        
        if not validate_email(email):
            return jsonify({'message': 'Email not found'}), 404
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Email not found'}), 404
        
        reset_token = secrets.token_urlsafe(32)
        
        cursor.execute(
            'INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)',
            (user['id'], reset_token)
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Password reset token generated',
            'reset_token': reset_token
        }), 200
        
    except Exception:
        return jsonify({'message': 'Email not found'}), 404

@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        token = data.get('token', '')
        new_password = data.get('new_password', '')
        
        if not token or not new_password:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        if not validate_password(new_password):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, user_id, created_at, used 
            FROM reset_tokens 
            WHERE token = ?
        ''', (token,))
        reset_token = cursor.fetchone()
        
        if not reset_token:
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        if reset_token['used'] == 1:
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        created_at = datetime.strptime(reset_token['created_at'], '%Y-%m-%d %H:%M:%S')
        if datetime.utcnow() - created_at > timedelta(hours=1):
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        password_hash = pbkdf2_sha256.hash(new_password)
        
        cursor.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            (password_hash, reset_token['user_id'])
        )
        
        cursor.execute(
            'UPDATE reset_tokens SET used = 1 WHERE id = ?',
            (reset_token['id'],)
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Password reset successful'}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid or expired token'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)