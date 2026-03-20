import os
import sqlite3
import uuid
import hashlib
import secrets
from flask import Flask, request, jsonify, g
from functools import wraps
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))

DATABASE = 'db.sqlite3'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS invitations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invite_id TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                invited_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                used BOOLEAN DEFAULT 0,
                FOREIGN KEY (invited_by) REFERENCES users(id)
            );
            
            CREATE INDEX IF NOT EXISTS idx_invite_id ON invitations(invite_id);
            CREATE INDEX IF NOT EXISTS idx_invite_email ON invitations(email);
        ''')
        db.commit()
        
        # Create initial admin user if no users exist
        cursor = db.execute('SELECT COUNT(*) as count FROM users')
        if cursor.fetchone()['count'] == 0:
            admin_password = pbkdf2_sha256.hash('admin123')
            db.execute('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
                      ('admin', admin_password, 'admin@example.com'))
            db.commit()

def authenticate_user():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload.get('user_id')
        if not user_id:
            return None
            
        db = get_db()
        cursor = db.execute('SELECT * FROM users WHERE id = ?', (user_id,))
        return cursor.fetchone()
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = authenticate_user()
        if not user:
            return jsonify({'message': 'Authentication required'}), 401
        g.current_user = user
        return f(*args, **kwargs)
    return decorated_function

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'message': 'Username and password required'}), 400
    
    username = data['username']
    password = data['password']
    
    db = get_db()
    cursor = db.execute('SELECT * FROM users WHERE username = ?', (username,))
    user = cursor.fetchone()
    
    if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    token = jwt.encode({
        'user_id': user['id'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({'token': token, 'message': 'Login successful'}), 200

@app.route('/invite_user', methods=['POST'])
@login_required
def invite_user():
    data = request.get_json()
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email'].strip().lower()
    
    # Validate email format
    if not email or '@' not in email or '.' not in email.split('@')[1]:
        return jsonify({'message': 'Invalid email format'}), 400
    
    db = get_db()
    
    # Check if user with this email already exists
    cursor = db.execute('SELECT * FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        return jsonify({'message': 'User with this email already exists'}), 400
    
    # Check if invitation already exists for this email
    cursor = db.execute('SELECT * FROM invitations WHERE email = ? AND used = 0', (email,))
    existing_invite = cursor.fetchone()
    
    if existing_invite:
        return jsonify({
            'invite_id': existing_invite['invite_id'],
            'message': 'Invitation already exists for this email'
        }), 200
    
    # Create new invitation
    invite_id = str(uuid.uuid4())
    current_user_id = g.current_user['id']
    
    try:
        db.execute('INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)',
                  (invite_id, email, current_user_id))
        db.commit()
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200
    except Exception as e:
        db.rollback()
        return jsonify({'message': 'Failed to create invitation'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    if not data or 'invite_id' not in data or 'user_name' not in data or 'password' not in data:
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
    
    invite_id = data['invite_id'].strip()
    username = data['user_name'].strip()
    password = data['password']
    
    # Validate inputs
    if not invite_id or not username or not password:
        return jsonify({'message': 'All fields are required'}), 400
    
    if len(username) < 3:
        return jsonify({'message': 'Username must be at least 3 characters long'}), 400
    
    if len(password) < 6:
        return jsonify({'message': 'Password must be at least 6 characters long'}), 400
    
    db = get_db()
    
    # Check if invitation exists and is valid
    cursor = db.execute('SELECT * FROM invitations WHERE invite_id = ? AND used = 0', (invite_id,))
    invitation = cursor.fetchone()
    
    if not invitation:
        return jsonify({'message': 'Invalid invite_id'}), 401
    
    # Check if username already exists
    cursor = db.execute('SELECT * FROM users WHERE username = ?', (username,))
    if cursor.fetchone():
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    
    # Create user
    password_hash = pbkdf2_sha256.hash(password)
    email = invitation['email']
    
    try:
        db.execute('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
                  (username, password_hash, email))
        
        # Mark invitation as used
        db.execute('UPDATE invitations SET used = 1 WHERE invite_id = ?', (invite_id,))
        
        db.commit()
        
        return jsonify({'message': 'User created successfully'}), 200
    except Exception as e:
        db.rollback()
        return jsonify({'message': 'Failed to create user'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)