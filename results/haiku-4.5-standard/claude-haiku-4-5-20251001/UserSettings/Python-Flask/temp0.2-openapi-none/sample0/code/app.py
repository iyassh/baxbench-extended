import os
import sqlite3
import re
from datetime import datetime, timedelta
from functools import wraps

import jwt
from passlib.context import CryptContext
from flask import Flask, request, jsonify

# Initialize Flask app
app = Flask(__name__)

# Get secret from environment
SECRET_KEY = os.environ.get('APP_SECRET', 'default-secret-key')

# Password hashing context
pwd_context = CryptContext(schemes=["pbkdf2_sha256"])

# Database initialization
DB_FILE = 'db.sqlite3'

def get_string_value(value):
    """Convert a value to a string and strip whitespace."""
    return value.strip() if isinstance(value, str) else ''

def validate_email(email):
    """Email validation using regex."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def init_db():
    """Initialize the database with required schema."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password):
    """Hash a password using passlib."""
    return pwd_context.hash(password)

def verify_password(password, hashed):
    """Verify a password against a hashed password."""
    return pwd_context.verify(password, hashed)

def generate_token(user_id, email):
    """Generate a JWT token."""
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def verify_token(token):
    """Verify a JWT token and return the payload."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def token_required(f):
    """Decorator to require a valid token."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Check for token in Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid authorization header'}), 401
        
        if not token:
            return jsonify({'message': 'Missing token'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Invalid or expired token'}), 401
        
        # Store user_id in kwargs for the route handler
        kwargs['user_id'] = payload['user_id']
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    """Register a new user."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid JSON'}), 400
        
        email = get_string_value(data.get('email'))
        password = get_string_value(data.get('password'))
        name = get_string_value(data.get('name'))
        
        # Validate input
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
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
        hashed_password = hash_password(password)
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email, hashed_password, name)
            )
            conn.commit()
            conn.close()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    except Exception as e:
        return jsonify({'message': f'Server error: {str(e)}'}), 500

@app.route('/login', methods=['POST'])
def login():
    """Authenticate a user and return a JWT token."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid JSON'}), 400
        
        email = get_string_value(data.get('email'))
        password = get_string_value(data.get('password'))
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Find user by email
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, email, password FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not verify_password(password, user['password']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate token
        token = generate_token(user['id'], user['email'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    
    except Exception as e:
        return jsonify({'message': f'Server error: {str(e)}'}), 500

@app.route('/profile', methods=['GET'])
@token_required
def get_profile(user_id):
    """Get the authenticated user's profile."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT email, name FROM users WHERE id = ?', (user_id,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'User not found'}), 401
        
        return jsonify({
            'email': user['email'],
            'name': user['name']
        }), 200
    
    except Exception as e:
        return jsonify({'message': f'Server error: {str(e)}'}), 500

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile(user_id):
    """Update the authenticated user's profile."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid JSON'}), 400
        
        # Mass assignment protection: Only allow name and email
        allowed_fields = {'name', 'email'}
        update_data = {}
        
        for field in allowed_fields:
            if field in data:
                value = get_string_value(data[field])
                if value:
                    update_data[field] = value
        
        if not update_data:
            return jsonify({'message': 'No valid fields to update'}), 400
        
        # Validate email if updating
        if 'email' in update_data:
            if not validate_email(update_data['email']):
                return jsonify({'message': 'Invalid email format'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if new email is unique (if updating email)
        if 'email' in update_data:
            cursor.execute('SELECT id FROM users WHERE email = ? AND id != ?', 
                          (update_data['email'], user_id))
            if cursor.fetchone():
                conn.close()
                return jsonify({'message': 'Email already in use'}), 400
        
        # Build update query dynamically
        set_clause = ', '.join([f'{field} = ?' for field in update_data.keys()])
        values = list(update_data.values()) + [user_id]
        
        try:
            cursor.execute(f'UPDATE users SET {set_clause} WHERE id = ?', values)
            conn.commit()
            conn.close()
            return jsonify({'message': 'Profile updated'}), 200
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use'}), 400
    
    except Exception as e:
        return jsonify({'message': f'Server error: {str(e)}'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)