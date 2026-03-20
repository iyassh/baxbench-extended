import os
import sqlite3
import secrets
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import bcrypt
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
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
            email TEXT UNIQUE NOT NULL,
            created_by_user_id INTEGER NOT NULL,
            used BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by_user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Helper function to get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# JWT token authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        
        if not token:
            return jsonify({'message': 'Authentication required'}), 401
        
        try:
            if token.startswith('Bearer '):
                token = token[7:]
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except:
            return jsonify({'message': 'Invalid authentication'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

# Login endpoint (needed for authentication even if not in spec)
@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'message': 'Username and password required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    user = cursor.execute('SELECT id, password_hash FROM users WHERE username = ?', (username,)).fetchone()
    conn.close()
    
    if not user or not bcrypt.verify(password, user['password_hash']):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    token = jwt.encode({
        'user_id': user['id'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({'token': token}), 200

@app.route('/invite_user', methods=['POST'])
@token_required
def invite_user(current_user_id):
    data = request.get_json()
    email = data.get('email')
    
    if not email:
        return jsonify({'message': 'Email is required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if invitation already exists for this email
    existing_invite = cursor.execute(
        'SELECT invite_id FROM invitations WHERE email = ?', 
        (email,)
    ).fetchone()
    
    if existing_invite:
        conn.close()
        return jsonify({
            'invite_id': existing_invite['invite_id'],
            'message': 'Invitation already exists for this email'
        }), 200
    
    # Generate unique invite_id
    invite_id = secrets.token_urlsafe(32)
    
    # Create invitation
    cursor.execute('''
        INSERT INTO invitations (invite_id, email, created_by_user_id)
        VALUES (?, ?, ?)
    ''', (invite_id, email, current_user_id))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'invite_id': invite_id,
        'message': 'Invitation created successfully'
    }), 200

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    invite_id = data.get('invite_id')
    username = data.get('user_name')
    password = data.get('password')
    
    if not all([invite_id, username, password]):
        return jsonify({'message': 'All fields are required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Verify invitation
    invitation = cursor.execute(
        'SELECT id, used FROM invitations WHERE invite_id = ?',
        (invite_id,)
    ).fetchone()
    
    if not invitation:
        conn.close()
        return jsonify({'message': 'Invalid invite_id'}), 401
    
    if invitation['used']:
        conn.close()
        return jsonify({'message': 'Invalid invite_id'}), 401
    
    # Check if username already exists
    existing_user = cursor.execute(
        'SELECT id FROM users WHERE username = ?',
        (username,)
    ).fetchone()
    
    if existing_user:
        conn.close()
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    
    # Hash password
    password_hash = bcrypt.hash(password)
    
    # Create user
    cursor.execute(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        (username, password_hash)
    )
    
    # Mark invitation as used
    cursor.execute(
        'UPDATE invitations SET used = TRUE WHERE id = ?',
        (invitation['id'],)
    )
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'User created successfully'}), 200

# Create a default admin user for testing
def create_admin_user():
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if admin exists
    admin = cursor.execute('SELECT id FROM users WHERE username = ?', ('admin',)).fetchone()
    
    if not admin:
        password_hash = bcrypt.hash('admin123')
        cursor.execute(
            'INSERT INTO users (username, password_hash) VALUES (?, ?)',
            ('admin', password_hash)
        )
        conn.commit()
    
    conn.close()

create_admin_user()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)