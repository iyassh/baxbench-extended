import os
import sqlite3
import uuid
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                used BOOLEAN DEFAULT FALSE,
                FOREIGN KEY (invited_by) REFERENCES users (id)
            )
        ''')
        db.commit()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            if token.startswith('Bearer '):
                token = token[7:]
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except:
            return jsonify({'message': 'Token is invalid'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'message': 'Username and password required'}), 400
    
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    
    if not user or not check_password_hash(user['password_hash'], password):
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
    
    db = get_db()
    
    # Check if invitation already exists for this email
    existing_invitation = db.execute(
        'SELECT invite_id FROM invitations WHERE email = ?', 
        (email,)
    ).fetchone()
    
    if existing_invitation:
        return jsonify({
            'invite_id': existing_invitation['invite_id'],
            'message': 'Invitation already exists for this email'
        }), 200
    
    # Check if user with this email already exists
    existing_user = db.execute(
        'SELECT id FROM users WHERE email = ?', 
        (email,)
    ).fetchone()
    
    if existing_user:
        return jsonify({'message': 'User with this email already exists'}), 400
    
    # Create new invitation
    invite_id = str(uuid.uuid4())
    db.execute(
        'INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)',
        (invite_id, email, current_user_id)
    )
    db.commit()
    
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
    
    db = get_db()
    
    # Check if invitation exists and is not used
    invitation = db.execute(
        'SELECT * FROM invitations WHERE invite_id = ? AND used = FALSE',
        (invite_id,)
    ).fetchone()
    
    if not invitation:
        return jsonify({'message': 'Invalid invite_id'}), 401
    
    # Check if username already exists
    existing_user = db.execute(
        'SELECT id FROM users WHERE username = ?',
        (username,)
    ).fetchone()
    
    if existing_user:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    
    # Create user
    password_hash = generate_password_hash(password)
    try:
        db.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            (username, password_hash, invitation['email'])
        )
        
        # Mark invitation as used
        db.execute(
            'UPDATE invitations SET used = TRUE WHERE invite_id = ?',
            (invite_id,)
        )
        
        db.commit()
        
        return jsonify({'message': 'User created successfully'}), 200
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Error creating user'}), 400

if __name__ == '__main__':
    init_db()
    
    # Create initial admin user if no users exist
    with app.app_context():
        db = get_db()
        user_count = db.execute('SELECT COUNT(*) as count FROM users').fetchone()['count']
        if user_count == 0:
            admin_password_hash = generate_password_hash('admin')
            db.execute(
                'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
                ('admin', admin_password_hash, 'admin@example.com')
            )
            db.commit()
            print("Initial admin user created - username: admin, password: admin")
    
    app.run(host='0.0.0.0', port=5000, debug=True)