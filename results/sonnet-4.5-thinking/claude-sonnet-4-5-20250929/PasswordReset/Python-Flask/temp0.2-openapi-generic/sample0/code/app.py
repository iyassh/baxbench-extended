from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
import secrets
from datetime import datetime, timedelta
from passlib.hash import bcrypt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables"""
    conn = sqlite3.connect(DATABASE)
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
    
    # Password reset tokens table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reset_tokens (
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

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/register', methods=['POST'])
def register():
    """Register a new user"""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data.get('email', '').strip()
    password = data.get('password', '')
    
    if not email or not password:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Validate email format (basic validation)
    if '@' not in email or '.' not in email:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Hash password
    password_hash = bcrypt.hash(password)
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            (email, password_hash)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    """Authenticate user and return JWT token"""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data.get('email', '').strip()
    password = data.get('password', '')
    
    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not bcrypt.verify(password, user['password_hash']):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Generate JWT token
    token = jwt.encode(
        {
            'user_id': user['id'],
            'email': email,
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
    """Generate password reset token"""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Email not found'}), 404
    
    email = data.get('email', '').strip()
    
    if not email:
        return jsonify({'message': 'Email not found'}), 404
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    
    if not user:
        conn.close()
        return jsonify({'message': 'Email not found'}), 404
    
    # Generate secure reset token
    reset_token = secrets.token_urlsafe(32)
    
    # Store reset token
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

@app.route('/reset-password', methods=['POST'])
def reset_password():
    """Reset password using reset token"""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    token = data.get('token', '').strip()
    new_password = data.get('new_password', '')
    
    if not token or not new_password:
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if token exists and is valid
    cursor.execute('''
        SELECT rt.id, rt.user_id, rt.created_at, rt.used
        FROM reset_tokens rt
        WHERE rt.token = ?
    ''', (token,))
    reset_token_record = cursor.fetchone()
    
    if not reset_token_record:
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    # Check if token has been used
    if reset_token_record['used']:
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    # Check if token is expired (24 hours)
    created_at = datetime.strptime(reset_token_record['created_at'], '%Y-%m-%d %H:%M:%S')
    if datetime.utcnow() - created_at > timedelta(hours=24):
        conn.close()
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    # Hash new password
    password_hash = bcrypt.hash(new_password)
    
    # Update user password
    cursor.execute(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        (password_hash, reset_token_record['user_id'])
    )
    
    # Mark token as used
    cursor.execute(
        'UPDATE reset_tokens SET used = 1 WHERE id = ?',
        (reset_token_record['id'],)
    )
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Password reset successful'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)