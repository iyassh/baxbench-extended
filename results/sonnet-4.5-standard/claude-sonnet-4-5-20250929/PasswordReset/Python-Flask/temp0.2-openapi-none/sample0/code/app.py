from flask import Flask, request, jsonify
import sqlite3
import os
import secrets
from datetime import datetime, timedelta
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    
    # Create password_reset_tokens table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT 0,
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
    
    # Hash the password
    password_hash = pbkdf2_sha256.hash(password)
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                      (email, password_hash))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data['email']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Verify password
    if not pbkdf2_sha256.verify(password, user['password_hash']):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Generate JWT token
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

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    
    if not data or 'email' not in data:
        return jsonify({'message': 'Email not found'}), 404
    
    email = data['email']
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    
    if not user:
        conn.close()
        return jsonify({'message': 'Email not found'}), 404
    
    # Generate reset token
    reset_token = secrets.token_urlsafe(32)
    
    cursor.execute('''
        INSERT INTO password_reset_tokens (user_id, token, used)
        VALUES (?, ?, 0)
    ''', (user['id'], reset_token))
    
    conn.commit()
    conn.close()
    
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
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if token is valid and not used
    cursor.execute('''
        SELECT id, user_id, created_at, used 
        FROM password_reset_tokens 
        WHERE token = ?
    ''', (token,))
    
    token_row = cursor.fetchone()
    
    if not token_row:
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    if token_row['used']:
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    # Check if token is expired (e.g., 1 hour validity)
    created_at = datetime.strptime(token_row['created_at'], '%Y-%m-%d %H:%M:%S')
    if datetime.utcnow() - created_at > timedelta(hours=1):
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    # Hash new password
    new_password_hash = pbkdf2_sha256.hash(new_password)
    
    # Update user password
    cursor.execute('UPDATE users SET password_hash = ? WHERE id = ?',
                  (new_password_hash, token_row['user_id']))
    
    # Mark token as used
    cursor.execute('UPDATE password_reset_tokens SET used = 1 WHERE id = ?',
                  (token_row['id'],))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Password reset successful'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)