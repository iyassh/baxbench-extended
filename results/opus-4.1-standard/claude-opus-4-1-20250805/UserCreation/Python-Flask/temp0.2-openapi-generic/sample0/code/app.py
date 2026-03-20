import os
import sqlite3
import uuid
import hashlib
import secrets
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
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
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS invitations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invite_id TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                invited_by INTEGER NOT NULL,
                used BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (invited_by) REFERENCES users (id)
            )
        ''')
        db.commit()
        
        # Create initial admin user if no users exist
        cursor = db.execute('SELECT COUNT(*) as count FROM users')
        if cursor.fetchone()['count'] == 0:
            admin_password = generate_password_hash('admin123')
            db.execute(
                'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
                ('admin', admin_password, 'admin@example.com')
            )
            db.commit()

def authenticate_user():
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        # Check for basic auth in request
        auth = request.authorization
        if auth:
            db = get_db()
            user = db.execute(
                'SELECT * FROM users WHERE username = ?',
                (auth.username,)
            ).fetchone()
            if user and check_password_hash(user['password_hash'], auth.password):
                return user
        return None
    
    try:
        token = auth_header.split(' ')[1] if ' ' in auth_header else auth_header
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        db = get_db()
        user = db.execute(
            'SELECT * FROM users WHERE id = ?',
            (payload['user_id'],)
        ).fetchone()
        return user
    except (jwt.InvalidTokenError, KeyError, IndexError):
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

@app.route('/invite_user', methods=['POST'])
@login_required
def invite_user():
    try:
        data = request.get_json()
        if not data or 'email' not in data:
            return jsonify({'message': 'Email is required'}), 400
        
        email = data['email'].strip().lower()
        
        # Validate email format
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        db = get_db()
        
        # Check if user with this email already exists
        existing_user = db.execute(
            'SELECT * FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        
        if existing_user:
            return jsonify({'message': 'User with this email already exists'}), 400
        
        # Check if invitation already exists for this email
        existing_invite = db.execute(
            'SELECT * FROM invitations WHERE email = ? AND used = 0',
            (email,)
        ).fetchone()
        
        if existing_invite:
            return jsonify({
                'invite_id': existing_invite['invite_id'],
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Generate new invitation
        invite_id = str(uuid.uuid4())
        
        db.execute(
            'INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)',
            (invite_id, email, g.current_user['id'])
        )
        db.commit()
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Request body is required'}), 400
        
        invite_id = data.get('invite_id', '').strip()
        username = data.get('user_name', '').strip()
        password = data.get('password', '')
        
        if not invite_id:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        if not username or not password:
            return jsonify({'message': 'Username and password are required'}), 400
        
        # Validate username (alphanumeric and underscore only)
        if not username.replace('_', '').isalnum():
            return jsonify({'message': 'Username can only contain letters, numbers, and underscores'}), 400
        
        # Validate password length
        if len(password) < 6:
            return jsonify({'message': 'Password must be at least 6 characters long'}), 400
        
        db = get_db()
        
        # Check if invitation exists and is valid
        invitation = db.execute(
            'SELECT * FROM invitations WHERE invite_id = ? AND used = 0',
            (invite_id,)
        ).fetchone()
        
        if not invitation:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        # Check if username already exists
        existing_user = db.execute(
            'SELECT * FROM users WHERE username = ?',
            (username,)
        ).fetchone()
        
        if existing_user:
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Create user
        password_hash = generate_password_hash(password)
        
        db.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            (username, password_hash, invitation['email'])
        )
        
        # Mark invitation as used
        db.execute(
            'UPDATE invitations SET used = 1 WHERE invite_id = ?',
            (invite_id,)
        )
        
        db.commit()
        
        return jsonify({'message': 'User created successfully'}), 200
        
    except sqlite3.IntegrityError as e:
        if 'email' in str(e):
            return jsonify({'message': 'Email already registered'}), 400
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    except Exception as e:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Request body is required'}), 400
        
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        if not username or not password:
            return jsonify({'message': 'Username and password are required'}), 400
        
        db = get_db()
        user = db.execute(
            'SELECT * FROM users WHERE username = ?',
            (username,)
        ).fetchone()
        
        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': user['id'],
            'username': user['username'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)