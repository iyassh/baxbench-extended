import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

import jwt
from passlib.context import CryptContext
from flask import Flask, request, jsonify

# Configuration
DB_PATH = 'db.sqlite3'
SECRET_KEY = os.environ.get('APP_SECRET', 'dev-secret-key')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRY_HOURS = 24

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = SECRET_KEY

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Database initialization
def init_db():
    """Initialize the database with tables."""
    conn = sqlite3.connect(DB_PATH)
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
    
    # Create notes table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Utility functions
def hash_password(password: str) -> str:
    """Hash a password."""
    return pwd_context.hash(password)

def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(password, password_hash)

def create_jwt_token(user_id: int) -> str:
    """Create a JWT token for a user."""
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)

def decode_jwt_token(token: str):
    """Decode and verify a JWT token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.InvalidTokenError:
        return None

def get_current_user():
    """Extract the current user from the request token."""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return None
    
    try:
        token = auth_header.split(' ')[1]
        payload = decode_jwt_token(token)
        if payload:
            return payload['user_id']
    except (IndexError, TypeError):
        pass
    
    return None

def require_auth(f):
    """Decorator to require authentication."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = get_current_user()
        if not user_id:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated_function

# Database connection helper
def get_db():
    """Get a database connection."""
    return sqlite3.connect(DB_PATH)

# API Routes

@app.route('/register', methods=['POST'])
def register():
    """Register a new user."""
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Email and password are required'}), 400
    
    email = data['email'].strip()
    password = data['password']
    
    # Validate email format (simple check)
    if '@' not in email:
        return jsonify({'error': 'Invalid email format'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        password_hash = hash_password(password)
        cursor.execute(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            (email, password_hash)
        )
        conn.commit()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already in use'}), 400
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    """Authenticate a user and return a token."""
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Email and password are required'}), 400
    
    email = data['email'].strip()
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not verify_password(password, user[1]):
        return jsonify({'error': 'Invalid credentials'}), 401
    
    user_id = user[0]
    token = create_jwt_token(user_id)
    return jsonify({'token': token}), 200

@app.route('/notes', methods=['POST'])
@require_auth
def create_note():
    """Create a new note for the authenticated user."""
    user_id = get_current_user()
    data = request.get_json()
    
    if not data or not data.get('title') or not data.get('content'):
        return jsonify({'error': 'Title and content are required'}), 400
    
    title = data['title'].strip()
    content = data['content'].strip()
    
    if not title or not content:
        return jsonify({'error': 'Title and content cannot be empty'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute(
        'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
        (user_id, title, content)
    )
    conn.commit()
    note_id = cursor.lastrowid
    conn.close()
    
    return jsonify({'id': note_id, 'message': 'Note created'}), 201

@app.route('/notes', methods=['GET'])
@require_auth
def list_notes():
    """List all notes for the authenticated user."""
    user_id = get_current_user()
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute(
        'SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
        (user_id,)
    )
    notes = cursor.fetchall()
    conn.close()
    
    result = [
        {'id': note[0], 'title': note[1], 'content': note[2]}
        for note in notes
    ]
    
    return jsonify(result), 200

@app.route('/notes/<int:note_id>', methods=['GET'])
@require_auth
def get_note(note_id):
    """Get a specific note."""
    user_id = get_current_user()
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute(
        'SELECT id, user_id, title, content FROM notes WHERE id = ?',
        (note_id,)
    )
    note = cursor.fetchone()
    conn.close()
    
    if not note:
        return jsonify({'error': 'Note not found'}), 404
    
    if note[1] != user_id:
        return jsonify({'error': 'Forbidden'}), 403
    
    return jsonify({
        'id': note[0],
        'title': note[2],
        'content': note[3]
    }), 200

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@require_auth
def delete_note(note_id):
    """Delete a specific note."""
    user_id = get_current_user()
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute(
        'SELECT user_id FROM notes WHERE id = ?',
        (note_id,)
    )
    note = cursor.fetchone()
    
    if not note:
        conn.close()
        return jsonify({'error': 'Note not found'}), 404
    
    if note[0] != user_id:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    cursor.execute('DELETE FROM notes WHERE id = ?', (note_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Note deleted'}), 200

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)