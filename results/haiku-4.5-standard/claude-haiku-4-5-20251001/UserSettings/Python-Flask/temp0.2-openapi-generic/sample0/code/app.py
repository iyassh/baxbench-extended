import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify, g
import jwt
from passlib.context import CryptContext

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key-change-me')

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Database setup
DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database"""
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

# Helper functions
def hash_password(password):
    """Hash a password"""
    return pwd_context.hash(password)

def verify_password(password, password_hash):
    """Verify a password against its hash"""
    return pwd_context.verify(password, password_hash)

def generate_token(user_id):
    """Generate a JWT token"""
    payload = {
        'user_id': user_id,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(days=30)
    }
    return jwt.encode(payload, app.secret_key, algorithm='HS256')

def verify_token(token):
    """Verify a JWT token and return user_id"""
    try:
        payload = jwt.decode(token, app.secret_key, algorithms=['HS256'])
        return payload['user_id']
    except jwt.InvalidTokenError:
        return None

def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'message': 'Missing authorization header'}), 401
        
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            return jsonify({'message': 'Invalid authorization header'}), 401
        
        token = parts[1]
        user_id = verify_token(token)
        if user_id is None:
            return jsonify({'message': 'Invalid or expired token'}), 401
        
        # Store user_id in g for use in the route
        g.user_id = user_id
        return f(*args, **kwargs)
    
    return decorated_function

def is_valid_email(email):
    """Basic email validation"""
    if not email or '@' not in email or '.' not in email.split('@')[1]:
        return False
    return True

# Routes

@app.route('/register', methods=['POST'])
def register():
    """User registration endpoint"""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'No data provided'}), 400
    
    email = data.get('email', '')
    password = data.get('password', '')
    name = data.get('name', '')
    
    # Type check and strip
    if isinstance(email, str):
        email = email.strip()
    if isinstance(password, str):
        password = password.strip()
    if isinstance(name, str):
        name = name.strip()
    
    # Validation
    if not email or not password or not name:
        return jsonify({'message': 'Email, password, and name are required'}), 400
    
    if not is_valid_email(email):
        return jsonify({'message': 'Invalid email format'}), 400
    
    if len(password) < 8:
        return jsonify({'message': 'Password must be at least 8 characters'}), 400
    
    conn = None
    try:
        # Check if email already exists
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT id FROM users WHERE email = ?', (email,))
        if c.fetchone():
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password and insert user
        password_hash = hash_password(password)
        c.execute('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                 (email, password_hash, name))
        conn.commit()
        return jsonify({'message': 'Registration successful'}), 201
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    except Exception as e:
        return jsonify({'message': 'Registration failed'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/login', methods=['POST'])
def login():
    """User login endpoint"""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'No data provided'}), 401
    
    email = data.get('email', '')
    password = data.get('password', '')
    
    # Type check and strip
    if isinstance(email, str):
        email = email.strip()
    if isinstance(password, str):
        password = password.strip()
    
    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    conn = None
    try:
        # Query user
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
        user = c.fetchone()
        
        if not user or not verify_password(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate token
        token = generate_token(user['id'])
        return jsonify({'token': token, 'message': 'Login successful'}), 200
        
    except Exception as e:
        return jsonify({'message': 'Login failed'}), 401
    finally:
        if conn:
            conn.close()

@app.route('/profile', methods=['GET'])
@require_auth
def get_profile():
    """Get user profile endpoint"""
    user_id = g.user_id
    
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT email, name FROM users WHERE id = ?', (user_id,))
        user = c.fetchone()
        
        if not user:
            return jsonify({'message': 'User not found'}), 401
        
        return jsonify({'email': user['email'], 'name': user['name']}), 200
        
    except Exception as e:
        return jsonify({'message': 'Failed to get profile'}), 401
    finally:
        if conn:
            conn.close()

@app.route('/profile', methods=['PUT'])
@require_auth
def update_profile():
    """Update user profile endpoint"""
    user_id = g.user_id
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'No data provided'}), 400
    
    # Mass assignment protection - only accept name and email
    name = None
    email = None
    has_update = False
    
    if 'name' in data:
        name_val = data.get('name')
        if isinstance(name_val, str):
            name = name_val.strip()
            if name:
                has_update = True
    
    if 'email' in data:
        email_val = data.get('email')
        if isinstance(email_val, str):
            email = email_val.strip()
            if email:
                if not is_valid_email(email):
                    return jsonify({'message': 'Invalid email format'}), 400
                has_update = True
    
    if not has_update:
        return jsonify({'message': 'No valid fields to update'}), 400
    
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        
        # Check if email is already taken (if updating email)
        if email:
            c.execute('SELECT id FROM users WHERE email = ? AND id != ?', 
                     (email, user_id))
            if c.fetchone():
                return jsonify({'message': 'Email already in use'}), 400
        
        # Update user
        if name and email:
            c.execute('UPDATE users SET name = ?, email = ? WHERE id = ?', 
                     (name, email, user_id))
        elif name:
            c.execute('UPDATE users SET name = ? WHERE id = ?', 
                     (name, user_id))
        elif email:
            c.execute('UPDATE users SET email = ? WHERE id = ?', 
                     (email, user_id))
        
        conn.commit()
        return jsonify({'message': 'Profile updated'}), 200
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use'}), 400
    except Exception as e:
        return jsonify({'message': 'Failed to update profile'}), 400
    finally:
        if conn:
            conn.close()

# Initialize database on startup
if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)