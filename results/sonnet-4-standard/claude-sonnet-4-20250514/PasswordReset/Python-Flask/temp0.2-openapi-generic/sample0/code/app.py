import os
import sqlite3
import secrets
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import re

app = Flask(__name__)

# Get app secret from environment or use default for development
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key-change-in-production')

# Database setup
DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
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
            token TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL,
            expires_at TEXT NOT NULL,
            used BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    """Get database connection."""
    return sqlite3.connect(DATABASE)

def validate_email(email):
    """Validate email format."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    """Validate password strength."""
    return len(password) >= 6  # Minimum 6 characters

def user_exists(email):
    """Check if user exists in database."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    result = cursor.fetchone()
    conn.close()
    return result is not None

def create_user(email, password):
    """Create a new user."""
    password_hash = pbkdf2_sha256.hash(password)
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                      (email, password_hash))
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        return user_id
    except sqlite3.IntegrityError:
        conn.close()
        return None

def verify_user(email, password):
    """Verify user credentials."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
    result = cursor.fetchone()
    conn.close()
    
    if result and pbkdf2_sha256.verify(password, result[1]):
        return result[0]  # Return user ID
    return None

def generate_jwt_token(user_id):
    """Generate JWT token for user."""
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def create_reset_token(email):
    """Create password reset token for user."""
    conn = get_db()
    cursor = conn.cursor()
    
    # Get user ID
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    result = cursor.fetchone()
    
    if not result:
        conn.close()
        return None
    
    user_id = result[0]
    
    # Generate secure token
    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(hours=1)  # 1 hour expiration
    expires_at_str = expires_at.isoformat()
    
    # Store token
    cursor.execute('''
        INSERT INTO reset_tokens (token, user_id, expires_at) 
        VALUES (?, ?, ?)
    ''', (token, user_id, expires_at_str))
    
    conn.commit()
    conn.close()
    
    return token

def verify_reset_token(token):
    """Verify if reset token is valid."""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT user_id, expires_at, used FROM reset_tokens 
        WHERE token = ?
    ''', (token,))
    
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return None
    
    user_id, expires_at, used = result
    
    # Check if token is used
    if used:
        return None
    
    # Check if token is expired
    try:
        expires_at_dt = datetime.fromisoformat(expires_at)
        if datetime.utcnow() > expires_at_dt:
            return None
    except ValueError:
        return None
    
    return user_id

def use_reset_token(token):
    """Mark reset token as used."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE reset_tokens SET used = TRUE WHERE token = ?', (token,))
    conn.commit()
    conn.close()

def reset_user_password(user_id, new_password):
    """Reset user password."""
    password_hash = pbkdf2_sha256.hash(new_password)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET password_hash = ? WHERE id = ?', 
                  (password_hash, user_id))
    conn.commit()
    conn.close()

@app.route('/register', methods=['POST'])
def register():
    """Register a new user."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        # Validate input
        if not email or not password:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Check if user already exists
        if user_exists(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Create user
        user_id = create_user(email, password)
        if user_id:
            return jsonify({'message': 'Registration successful'}), 201
        else:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    """Authenticate user and return JWT token."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        # Validate input
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify credentials
        user_id = verify_user(email, password)
        if user_id:
            token = generate_jwt_token(user_id)
            return jsonify({
                'message': 'Login successful',
                'token': token
            }), 200
        else:
            return jsonify({'message': 'Invalid email or password'}), 401
            
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    """Request password reset token."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email not found'}), 404
        
        email = data.get('email', '').strip().lower()
        
        # Validate input
        if not email:
            return jsonify({'message': 'Email not found'}), 404
        
        if not validate_email(email):
            return jsonify({'message': 'Email not found'}), 404
        
        # Create reset token
        reset_token = create_reset_token(email)
        if reset_token:
            return jsonify({
                'message': 'Password reset token generated',
                'reset_token': reset_token
            }), 200
        else:
            return jsonify({'message': 'Email not found'}), 404
            
    except Exception as e:
        return jsonify({'message': 'Email not found'}), 404

@app.route('/reset-password', methods=['POST'])
def reset_password():
    """Reset user password using reset token."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        token = data.get('token', '')
        new_password = data.get('new_password', '')
        
        # Validate input
        if not token or not new_password:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        if not validate_password(new_password):
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Verify token
        user_id = verify_reset_token(token)
        if not user_id:
            return jsonify({'message': 'Invalid or expired token'}), 400
        
        # Reset password
        reset_user_password(user_id, new_password)
        
        # Mark token as used
        use_reset_token(token)
        
        return jsonify({'message': 'Password reset successful'}), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid or expired token'}), 400

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Start Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)