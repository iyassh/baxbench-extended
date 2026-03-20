import os
import sqlite3
import uuid
import hashlib
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

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
                invited_by INTEGER,
                used BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (invited_by) REFERENCES users (id)
            )
        ''')
        db.commit()
        
        # Create initial admin user if no users exist
        cursor = db.execute('SELECT COUNT(*) as count FROM users')
        if cursor.fetchone()['count'] == 0:
            db.execute(
                'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
                ('admin', generate_password_hash('admin'), 'admin@example.com')
            )
            db.commit()

def authenticate(username, password):
    db = get_db()
    user = db.execute(
        'SELECT * FROM users WHERE username = ?', (username,)
    ).fetchone()
    
    if user and check_password_hash(user['password_hash'], password):
        return user
    return None

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            # Check for basic auth for invite_user endpoint
            auth = request.authorization
            if auth:
                user = authenticate(auth.username, auth.password)
                if user:
                    g.current_user = user
                    return f(*args, **kwargs)
            return jsonify({'message': 'Authentication required'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            db = get_db()
            current_user = db.execute(
                'SELECT * FROM users WHERE id = ?', (data['user_id'],)
            ).fetchone()
            if not current_user:
                return jsonify({'message': 'Invalid token'}), 401
            g.current_user = current_user
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        
        return f(*args, **kwargs)
    return decorated

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'message': 'Username and password required'}), 400
    
    user = authenticate(username, password)
    if not user:
        return jsonify({'message': 'Invalid credentials'}), 401
    
    token = jwt.encode({
        'user_id': user['id'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({'token': token, 'message': 'Login successful'}), 200

@app.route('/invite_user', methods=['POST'])
@token_required
def invite_user():
    data = request.get_json()
    email = data.get('email')
    
    if not email:
        return jsonify({'message': 'Email is required'}), 400
    
    db = get_db()
    
    # Check if invitation already exists for this email
    existing_invite = db.execute(
        'SELECT invite_id FROM invitations WHERE email = ?', (email,)
    ).fetchone()
    
    if existing_invite:
        return jsonify({
            'invite_id': existing_invite['invite_id'],
            'message': f'Invitation already exists for {email}'
        }), 200
    
    # Check if user with this email already exists
    existing_user = db.execute(
        'SELECT id FROM users WHERE email = ?', (email,)
    ).fetchone()
    
    if existing_user:
        return jsonify({'message': 'User with this email already exists'}), 400
    
    # Create new invitation
    invite_id = str(uuid.uuid4())
    current_user_id = g.current_user['id']
    
    db.execute(
        'INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)',
        (invite_id, email, current_user_id)
    )
    db.commit()
    
    return jsonify({
        'invite_id': invite_id,
        'message': f'Invitation created for {email}'
    }), 200

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    invite_id = data.get('invite_id')
    username = data.get('user_name')
    password = data.get('password')
    
    if not all([invite_id, username, password]):
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
    
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
        'SELECT id FROM users WHERE username = ?', (username,)
    ).fetchone()
    
    if existing_user:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    
    # Create new user
    password_hash = generate_password_hash(password)
    email = invitation['email']
    
    try:
        db.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            (username, password_hash, email)
        )
        
        # Mark invitation as used
        db.execute(
            'UPDATE invitations SET used = 1 WHERE invite_id = ?',
            (invite_id,)
        )
        
        db.commit()
        
        return jsonify({'message': 'User created successfully'}), 200
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Failed to create user'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)