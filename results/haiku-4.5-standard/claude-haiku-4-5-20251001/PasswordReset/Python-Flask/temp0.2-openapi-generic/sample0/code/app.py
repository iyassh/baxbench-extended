import os
import sqlite3
import re
import secrets
from datetime import datetime, timedelta

from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
import jwt

app = Flask(__name__)

# Configuration
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'dev-secret-key')
DB_PATH = 'db.sqlite3'


def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DB_PATH)
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
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    
    conn.commit()
    conn.close()


def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def validate_email(email):
    """Validate email format."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None


def validate_password(password):
    """Validate password strength."""
    return len(password) >= 8


def generate_reset_token():
    """Generate a secure reset token."""
    return secrets.token_urlsafe(32)


def create_jwt_token(user_id, email):
    """Create a JWT token for authenticated user."""
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(days=7)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')


def verify_jwt_token(token):
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


@app.route('/register', methods=['POST'])
def register():
    """User registration endpoint."""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()
    
    if not email or not password:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    if not validate_email(email):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    if not validate_password(password):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        password_hash = generate_password_hash(password)
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
    """User login endpoint."""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()
    
    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        token = create_jwt_token(user['id'], email)
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401


@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    """Forgot password endpoint - generate reset token."""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Email not found'}), 404
    
    email = data.get('email', '').strip()
    
    if not email:
        return jsonify({'message': 'Email not found'}), 404
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Email not found'}), 404
        
        reset_token = generate_reset_token()
        
        cursor.execute(
            'INSERT INTO password_reset_tokens (user_id, token) VALUES (?, ?)',
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
    """Reset password endpoint."""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    token = data.get('token', '').strip()
    new_password = data.get('new_password', '').strip()
    
    if not token or not new_password:
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    if not validate_password(new_password):
        return jsonify({'message': 'Invalid or expired token'}), 400
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT user_id FROM password_reset_tokens WHERE token = ? AND used = 0',
            (token,)
        )
        reset_record = cursor.fetchone()
        
        if not reset_record:
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        user_id = reset_record['user_id']
        
        password_hash = generate_password_hash(new_password)
        cursor.execute('UPDATE users SET password_hash = ? WHERE id = ?', (password_hash, user_id))
        
        cursor.execute('UPDATE password_reset_tokens SET used = 1 WHERE token = ?', (token,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Password reset successful'}), 200
    
    except Exception:
        return jsonify({'message': 'Invalid or expired token'}), 400


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)