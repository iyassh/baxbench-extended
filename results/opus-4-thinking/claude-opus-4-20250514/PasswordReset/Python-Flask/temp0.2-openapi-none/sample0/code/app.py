from flask import Flask, request, jsonify
import sqlite3
import os
import secrets
import jwt
from datetime import datetime, timedelta
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    ''')
    
    # Create reset_tokens table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP NOT NULL,
            used BOOLEAN DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    # Validate email format (basic check)
    if '@' not in email:
        return jsonify({'message': 'Invalid email format'}), 400
    
    # Hash the password
    hashed_password = pbkdf2_sha256.hash(password)
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('INSERT INTO users (email, password) VALUES (?, ?)', 
                      (email, hashed_password))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data['email']
    password = data['password']
    
    conn = get_db_connection()
    cursor = conn.cursor()
    user = cursor.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()
    
    if user and pbkdf2_sha256.verify(password, user['password']):
        # Generate JWT token
        token_payload = {
            'user_id': user['id'],
            'email': user['email'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(token_payload, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    else:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email']
    
    conn = get_db_connection()
    cursor = conn.cursor()
    user = cursor.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    
    if not user:
        conn.close()
        return jsonify({'message': 'Email not found'}), 404
    
    # Generate reset token
    reset_token = secrets.token_urlsafe(32)
    
    # Store token in database
    cursor.execute('''
        INSERT INTO reset_tokens (user_id, token, created_at)
        VALUES (?, ?, ?)
    ''', (user['id'], reset_token, datetime.utcnow()))
    
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
        return jsonify({'message': 'Token and new password are required'}), 400
    
    token = data['token']
    new_password = data['new_password']
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Find the token and check if it's valid
    token_data = cursor.execute('''
        SELECT rt.*, u.id as user_id 
        FROM reset_tokens rt 
        JOIN users u ON rt.user_id = u.id 
        WHERE rt.token = ? AND rt.used = 0
    ''', (token,)).fetchone()
    
    if not token_data:
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    # Check if token is not older than 1 hour
    created_at = datetime.fromisoformat(token_data['created_at'])
    if datetime.utcnow() - created_at > timedelta(hours=1):
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    # Hash the new password
    hashed_password = pbkdf2_sha256.hash(new_password)
    
    # Update user's password
    cursor.execute('UPDATE users SET password = ? WHERE id = ?', 
                  (hashed_password, token_data['user_id']))
    
    # Mark token as used
    cursor.execute('UPDATE reset_tokens SET used = 1 WHERE token = ?', (token,))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Password reset successful'}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)