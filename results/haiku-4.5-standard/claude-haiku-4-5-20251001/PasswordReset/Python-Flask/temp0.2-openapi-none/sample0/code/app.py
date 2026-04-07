import os
import sqlite3
from datetime import datetime, timedelta
import secrets

from flask import Flask, request, jsonify
import jwt
from passlib.context import CryptContext

app = Flask(__name__)

# Configuration
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

# Password hashing context
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Initialize database
def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create password reset tokens table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            used BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def validate_email(email):
    """Simple email validation"""
    return '@' in email and '.' in email

def hash_password(password):
    """Hash a password"""
    return pwd_context.hash(password)

def verify_password(password, password_hash):
    """Verify a password against its hash"""
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        return False

def generate_jwt_token(user_id):
    """Generate a JWT token"""
    payload = {
        'user_id': user_id,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def generate_reset_token():
    """Generate a unique reset token"""
    return secrets.token_urlsafe(32)

def parse_datetime(datetime_str):
    """Parse SQLite datetime string"""
    try:
        return datetime.strptime(datetime_str, '%Y-%m-%d %H:%M:%S')
    except Exception:
        return None

@app.route('/register', methods=['POST'])
def register():
    """Register a new user"""
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Email and password are required'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        # Validate email format
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Validate password length
        if len(password) < 6:
            return jsonify({'message': 'Password must be at least 6 characters'}), 400
        
        # Check if email already exists
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password and insert user
        password_hash = hash_password(password)
        cursor.execute(
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
    """Authenticate a user and return a JWT token"""
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        # Find user by email
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not verify_password(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = generate_jwt_token(user['id'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    """Request a password reset token"""
    try:
        data = request.get_json()
        
        if not data or 'email' not in data:
            return jsonify({'message': 'Email not found'}), 404
        
        email = data.get('email', '').strip()
        
        # Find user by email
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Email not found'}), 404
        
        # Generate reset token
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
    
    except Exception as e:
        return jsonify({'message': 'Email not found'}), 404

@app.route('/reset-password', methods=['POST'])
def reset_password():
    """Reset password using a reset token"""
    try:
        data = request.get_json()
        
        if not data or 'token' not in data or 'new_password' not in data:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        token = data.get('token', '').strip()
        new_password = data.get('new_password', '').strip()
        
        # Validate new password
        if len(new_password) < 6:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Find reset token
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT user_id, created_at FROM password_reset_tokens WHERE token = ? AND used = FALSE',
            (token,)
        )
        reset_token_record = cursor.fetchone()
        
        if not reset_token_record:
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Check if token is expired (1 hour)
        created_at = parse_datetime(reset_token_record['created_at'])
        if not created_at or datetime.utcnow() - created_at > timedelta(hours=1):
            conn.close()
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        user_id = reset_token_record['user_id']
        
        # Hash new password and update user
        password_hash = hash_password(new_password)
        cursor.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            (password_hash, user_id)
        )
        
        # Mark token as used
        cursor.execute(
            'UPDATE password_reset_tokens SET used = TRUE WHERE token = ?',
            (token,)
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Password reset successful'}), 200
    
    except Exception as e:
        return jsonify({'message': 'Invalid or expired token'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)