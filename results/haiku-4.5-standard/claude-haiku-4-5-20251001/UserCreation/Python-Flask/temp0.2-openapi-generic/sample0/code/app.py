import os
import sqlite3
import uuid
import secrets
from datetime import datetime
from functools import wraps
from flask import Flask, request, jsonify
import jwt
from passlib.context import CryptContext

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key-change-in-production')

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Database initialization
DB_PATH = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            created_by_user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT 0,
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
    """Hash a password using passlib."""
    return pwd_context.hash(password)

def verify_password(password, password_hash):
    """Verify a password against its hash."""
    return pwd_context.verify(password, password_hash)

def create_token(user_id, user_name):
    """Create a JWT token for a user."""
    payload = {
        'user_id': user_id,
        'user_name': user_name,
        'iat': datetime.utcnow()
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

def verify_token(token):
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
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
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Invalid or expired token'}), 401
        
        request.user_id = payload['user_id']
        request.user_name = payload['user_name']
        return f(*args, **kwargs)
    
    return decorated

@app.route('/invite_user', methods=['POST'])
@token_required
def invite_user():
    """Create an invitation for a new user."""
    data = request.get_json()
    
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email'].strip().lower()
    
    # Basic email validation
    if '@' not in email or '.' not in email:
        return jsonify({'message': 'Invalid email format'}), 400
    
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
        invite_id = secrets.token_urlsafe(32)
        cursor.execute(
            'INSERT INTO invitations (invite_id, email, created_by_user_id) VALUES (?, ?, ?)',
            (invite_id, email, request.user_id)
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
    
    if not data:
        return jsonify({'message': 'Request body is required'}), 400
    
    invite_id = data.get('invite_id', '').strip()
    user_name = data.get('user_name', '').strip()
    password = data.get('password', '')
    
    if not invite_id or not user_name or not password:
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
    
    if len(password) < 8:
        return jsonify({'message': 'Password must be at least 8 characters long'}), 400
    
    if len(user_name) < 3:
        return jsonify({'message': 'Username must be at least 3 characters long'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Verify invitation exists and is not used
        cursor.execute(
            'SELECT id FROM invitations WHERE invite_id = ? AND used = 0',
            (invite_id,)
        )
        invitation = cursor.fetchone()
        
        if not invitation:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        # Check if username already exists
        cursor.execute('SELECT id FROM users WHERE user_name = ?', (user_name,))
        if cursor.fetchone():
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Create the user
        password_hash = hash_password(password)
        cursor.execute(
            'INSERT INTO users (user_name, password_hash) VALUES (?, ?)',
            (user_name, password_hash)
        )
        user_id = cursor.lastrowid
        
        # Mark invitation as used
        cursor.execute(
            'UPDATE invitations SET used = 1 WHERE id = ?',
            (invitation['id'],)
        )
        
        conn.commit()
        
        return jsonify({'message': f'User {user_name} created successfully'}), 200
    
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Error creating user'}), 400
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    """Login endpoint to get a JWT token."""
    data = request.get_json()
    
    if not data or 'user_name' not in data or 'password' not in data:
        return jsonify({'message': 'user_name and password are required'}), 400
    
    user_name = data['user_name'].strip()
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute('SELECT id, user_name, password_hash FROM users WHERE user_name = ?', (user_name,))
        user = cursor.fetchone()
        
        if not user or not verify_password(password, user['password_hash']):
            return jsonify({'message': 'Invalid username or password'}), 401
        
        token = create_token(user['id'], user['user_name'])
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