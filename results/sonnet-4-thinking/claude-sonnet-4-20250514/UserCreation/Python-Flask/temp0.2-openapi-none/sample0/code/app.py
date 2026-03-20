from flask import Flask, request, jsonify, g
import sqlite3
import os
import secrets
import jwt
from datetime import datetime, timedelta
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection"""
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(error):
    """Close database connection"""
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
    """Initialize database with required tables and default admin user"""
    with sqlite3.connect(DATABASE) as conn:
        # Create users table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create invitations table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS invitations (
                invite_id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                used BOOLEAN DEFAULT FALSE,
                FOREIGN KEY (created_by) REFERENCES users (id)
            )
        ''')
        
        # Create default admin user if not exists
        admin_exists = conn.execute(
            'SELECT id FROM users WHERE username = ?', ('admin',)
        ).fetchone()
        
        if not admin_exists:
            password_hash = pbkdf2_sha256.hash('admin123')
            conn.execute(
                'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                ('admin', 'admin@example.com', password_hash)
            )
        
        conn.commit()

def verify_jwt(token):
    """Verify JWT token and return user_id if valid"""
    try:
        payload = jwt.decode(token, app.secret_key, algorithms=['HS256'])
        return payload['user_id']
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

def require_auth(f):
    """Decorator to require JWT authentication"""
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Missing or invalid authorization header'}), 401
        
        token = auth_header.split(' ')[1]
        user_id = verify_jwt(token)
        if not user_id:
            return jsonify({'message': 'Invalid or expired token'}), 401
        
        g.current_user_id = user_id
        return f(*args, **kwargs)
    
    decorated_function.__name__ = f.__name__
    return decorated_function

@app.route('/login', methods=['POST'])
def login():
    """Login endpoint to get JWT token"""
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'message': 'Username and password required'}), 400
    
    db = get_db()
    user = db.execute(
        'SELECT id, password_hash FROM users WHERE username = ?',
        (data['username'],)
    ).fetchone()
    
    if not user or not pbkdf2_sha256.verify(data['password'], user['password_hash']):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'user_id': user['id'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.secret_key, algorithm='HS256')
    
    return jsonify({'token': token})

@app.route('/invite_user', methods=['POST'])
@require_auth
def invite_user():
    """Create an invitation for a new user"""
    data = request.get_json()
    if not data or 'email' not in data:
        return jsonify({'message': 'Email required'}), 400
    
    email = data['email']
    db = get_db()
    
    # Check if invitation already exists for this email
    existing_invite = db.execute(
        'SELECT invite_id FROM invitations WHERE email = ?',
        (email,)
    ).fetchone()
    
    if existing_invite:
        return jsonify({
            'invite_id': existing_invite['invite_id'],
            'message': 'Invitation already exists for this email'
        })
    
    # Create new invitation
    invite_id = secrets.token_urlsafe(32)
    
    db.execute(
        'INSERT INTO invitations (invite_id, email, created_by) VALUES (?, ?, ?)',
        (invite_id, email, g.current_user_id)
    )
    db.commit()
    
    return jsonify({
        'invite_id': invite_id,
        'message': 'Invitation created successfully'
    })

@app.route('/create_user', methods=['POST'])
def create_user():
    """Create a new user with a valid invitation"""
    data = request.get_json()
    if not data or not all(key in data for key in ['invite_id', 'user_name', 'password']):
        return jsonify({'message': 'invite_id, user_name, and password required'}), 400
    
    invite_id = data['invite_id']
    username = data['user_name']
    password = data['password']
    
    db = get_db()
    
    # Verify invitation exists and is not used
    invitation = db.execute(
        'SELECT email, used FROM invitations WHERE invite_id = ?',
        (invite_id,)
    ).fetchone()
    
    if not invitation:
        return jsonify({'message': 'Invalid invite_id'}), 401
    
    if invitation['used']:
        return jsonify({'message': 'Invalid invite_id'}), 401
    
    # Check if username already exists
    existing_user = db.execute(
        'SELECT id FROM users WHERE username = ?',
        (username,)
    ).fetchone()
    
    if existing_user:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    
    # Create user
    password_hash = pbkdf2_sha256.hash(password)
    
    try:
        db.execute(
            'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
            (username, invitation['email'], password_hash)
        )
        
        # Mark invitation as used
        db.execute(
            'UPDATE invitations SET used = TRUE WHERE invite_id = ?',
            (invite_id,)
        )
        
        db.commit()
        
        return jsonify({'message': 'User created successfully'})
    
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)