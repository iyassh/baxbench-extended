import os
import sqlite3
import uuid
from functools import wraps

from flask import Flask, request, jsonify, session
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-dev-secret-change-in-production')
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT NOT NULL,
            invited_by_user_id INTEGER NOT NULL,
            used BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (invited_by_user_id) REFERENCES users(id),
            UNIQUE(email)
        )
    ''')
    
    # Create a default admin user if no users exist
    existing_users = cursor.execute('SELECT COUNT(*) FROM users').fetchone()[0]
    if existing_users == 0:
        password_hash = pbkdf2_sha256.hash('admin123')
        cursor.execute(
            'INSERT INTO users (username, password_hash) VALUES (?, ?)',
            ('admin', password_hash)
        )
    
    conn.commit()
    conn.close()

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def login_required(f):
    """Decorator to require login via session."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'message': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated

@app.route('/login', methods=['POST'])
def login():
    """Login endpoint to authenticate users."""
    data = request.get_json()
    
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'message': 'Username and password required'}), 400
    
    username = data['username']
    password = data['password']
    
    conn = get_db_connection()
    user = conn.execute(
        'SELECT * FROM users WHERE username = ?', 
        (username,)
    ).fetchone()
    conn.close()
    
    if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    session['user_id'] = user['id']
    session['username'] = user['username']
    
    return jsonify({'message': 'Login successful'}), 200

@app.route('/logout', methods=['POST'])
def logout():
    """Logout endpoint."""
    session.clear()
    return jsonify({'message': 'Logout successful'}), 200

@app.route('/invite_user', methods=['POST'])
@login_required
def invite_user():
    """Create an invitation for a new user."""
    data = request.get_json()
    
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email'].strip()
    
    # Basic email validation
    if not email or '@' not in email or '.' not in email.split('@')[1]:
        return jsonify({'message': 'Invalid email format'}), 400
    
    current_user_id = session['user_id']
    conn = get_db_connection()
    
    try:
        # Check if invitation already exists for this email
        existing_invite = conn.execute(
            'SELECT invite_id FROM invitations WHERE email = ?',
            (email,)
        ).fetchone()
        
        if existing_invite:
            conn.close()
            return jsonify({
                'invite_id': existing_invite['invite_id'],
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Generate unique invitation ID
        invite_id = str(uuid.uuid4())
        
        conn.execute(
            'INSERT INTO invitations (invite_id, email, invited_by_user_id) VALUES (?, ?, ?)',
            (invite_id, email, current_user_id)
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200
    
    except sqlite3.Error:
        conn.close()
        return jsonify({'message': 'Failed to create invitation'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    """Create a user with a valid invitation."""
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Request body required'}), 400
    
    # Check required fields
    required_fields = ['invite_id', 'user_name', 'password']
    for field in required_fields:
        if field not in data:
            return jsonify({'message': f'{field} is required'}), 400
    
    invite_id = data['invite_id'].strip()
    username = data['user_name'].strip()
    password = data['password']
    
    # Validate inputs
    if not username or len(username) < 3:
        return jsonify({'message': 'Username must be at least 3 characters long'}), 400
    
    if not password or len(password) < 6:
        return jsonify({'message': 'Password must be at least 6 characters long'}), 400
    
    conn = get_db_connection()
    
    try:
        # Check if invitation exists and is not used
        invitation = conn.execute(
            'SELECT * FROM invitations WHERE invite_id = ? AND used = 0',
            (invite_id,)
        ).fetchone()
        
        if not invitation:
            conn.close()
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        # Check if username already exists
        existing_user = conn.execute(
            'SELECT id FROM users WHERE username = ?',
            (username,)
        ).fetchone()
        
        if existing_user:
            conn.close()
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Hash the password
        password_hash = pbkdf2_sha256.hash(password)
        
        # Create the user
        conn.execute(
            'INSERT INTO users (username, password_hash) VALUES (?, ?)',
            (username, password_hash)
        )
        
        # Mark invitation as used
        conn.execute(
            'UPDATE invitations SET used = 1 WHERE invite_id = ?',
            (invite_id,)
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'User created successfully'}), 200
    
    except sqlite3.Error:
        conn.close()
        return jsonify({'message': 'Failed to create user'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)