import os
import sqlite3
import uuid
import json
from datetime import datetime
from functools import wraps
from flask import Flask, request, jsonify
from passlib.context import CryptContext
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'default-secret-key')

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Database initialization
DB_PATH = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            created_by_user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used INTEGER DEFAULT 0,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password):
    """Hash a password."""
    return pwd_context.hash(password)

def verify_password(password, password_hash):
    """Verify a password against its hash."""
    return pwd_context.verify(password, password_hash)

def get_current_user():
    """Extract and verify JWT token from request headers."""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return None
    
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload.get('user_id')
    except (IndexError, jwt.InvalidTokenError, jwt.ExpiredSignatureError):
        return None

def require_auth(f):
    """Decorator to require authentication."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = get_current_user()
        if not user_id:
            return jsonify({'message': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated_function

@app.route('/invite_user', methods=['POST'])
@require_auth
def invite_user():
    """Create an invitation for a new user."""
    data = request.get_json()
    
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email']
    user_id = get_current_user()
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Check if invitation already exists for this email
        cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
        existing = cursor.fetchone()
        
        if existing:
            return jsonify({
                'invite_id': existing['invite_id'],
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Create new invitation
        invite_id = str(uuid.uuid4())
        cursor.execute(
            'INSERT INTO invitations (invite_id, email, created_by_user_id) VALUES (?, ?, ?)',
            (invite_id, email, user_id)
        )
        conn.commit()
        
        return jsonify({
            'invite_id': invite_id,
            'message': f'Invitation created for {email}'
        }), 200
    
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Error creating invitation'}), 400
    finally:
        conn.close()

@app.route('/create_user', methods=['POST'])
def create_user():
    """Create a new user with a valid invitation."""
    data = request.get_json()
    
    if not data or 'invite_id' not in data or 'user_name' not in data or 'password' not in data:
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
    
    invite_id = data['invite_id']
    user_name = data['user_name']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Verify invitation exists and is not used
        cursor.execute('SELECT id, email FROM invitations WHERE invite_id = ? AND used = 0', (invite_id,))
        invitation = cursor.fetchone()
        
        if not invitation:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        # Check if username already exists
        cursor.execute('SELECT id FROM users WHERE user_name = ?', (user_name,))
        if cursor.fetchone():
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Create new user
        password_hash = hash_password(password)
        cursor.execute(
            'INSERT INTO users (user_name, password_hash) VALUES (?, ?)',
            (user_name, password_hash)
        )
        conn.commit()
        
        # Mark invitation as used
        cursor.execute('UPDATE invitations SET used = 1 WHERE id = ?', (invitation['id'],))
        conn.commit()
        
        return jsonify({'message': 'User created successfully'}), 200
    
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    """Login endpoint to get JWT token."""
    data = request.get_json()
    
    if not data or 'user_name' not in data or 'password' not in data:
        return jsonify({'message': 'user_name and password are required'}), 400
    
    user_name = data['user_name']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute('SELECT id, password_hash FROM users WHERE user_name = ?', (user_name,))
        user = cursor.fetchone()
        
        if not user or not verify_password(password, user['password_hash']):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Create JWT token
        token = jwt.encode(
            {'user_id': user['id']},
            app.config['SECRET_KEY'],
            algorithm='HS256'
        )
        
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    
    finally:
        conn.close()

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)