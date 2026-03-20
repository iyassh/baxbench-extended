from flask import Flask, request, jsonify, g
from functools import wraps
import sqlite3
import os
import uuid
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key')

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            invite_id TEXT PRIMARY KEY,
            inviter_id INTEGER NOT NULL,
            email TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (inviter_id) REFERENCES users (id)
        )
    ''')
    
    cursor.execute('SELECT id FROM users WHERE username = ?', ('admin',))
    if not cursor.fetchone():
        admin_password_hash = pbkdf2_sha256.hash('admin123')
        cursor.execute('''
            INSERT INTO users (username, email, password_hash)
            VALUES (?, ?, ?)
        ''', ('admin', 'admin@example.com', admin_password_hash))
    
    conn.commit()
    conn.close()

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
            
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            cursor.execute('SELECT id, username, email FROM users WHERE id = ?', (current_user_id,))
            user = cursor.fetchone()
            conn.close()
            
            if not user:
                return jsonify({'message': 'Invalid token'}), 401
            
            g.current_user = {
                'id': user[0],
                'username': user[1],
                'email': user[2]
            }
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        
        return f(*args, **kwargs)
    return decorated

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'message': 'Username and password required'}), 400
    
    username = data['username']
    password = data['password']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, username, password_hash FROM users WHERE username = ?', (username,))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not pbkdf2_sha256.verify(password, user[2]):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    token = jwt.encode({
        'user_id': user[0],
        'username': user[1],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'token': token,
        'message': 'Login successful'
    })

@app.route('/invite_user', methods=['POST'])
@token_required
def invite_user():
    data = request.get_json()
    if not data or not data.get('email'):
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email']
    
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, email):
        return jsonify({'message': 'Invalid email format'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
    existing_invitation = cursor.fetchone()
    
    if existing_invitation:
        conn.close()
        return jsonify({
            'invite_id': existing_invitation[0],
            'message': 'Email already invited'
        })
    
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    existing_user = cursor.fetchone()
    
    if existing_user:
        conn.close()
        return jsonify({'message': 'Email already has an account'}), 400
    
    invite_id = str(uuid.uuid4())
    
    cursor.execute('''
        INSERT INTO invitations (invite_id, inviter_id, email)
        VALUES (?, ?, ?)
    ''', (invite_id, g.current_user['id'], email))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'invite_id': invite_id,
        'message': 'Invitation created successfully'
    })

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    if not data or not all(k in data for k in ('invite_id', 'user_name', 'password')):
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
    
    invite_id = data['invite_id']
    username = data['user_name']
    password = data['password']
    
    if len(username.strip()) == 0:
        return jsonify({'message': 'Username cannot be empty'}), 400
    
    if len(password) < 6:
        return jsonify({'message': 'Password must be at least 6 characters'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT email, used FROM invitations WHERE invite_id = ?', (invite_id,))
    invitation = cursor.fetchone()
    
    if not invitation:
        conn.close()
        return jsonify({'message': 'Invalid invite_id'}), 401
    
    email, used = invitation
    if used:
        conn.close()
        return jsonify({'message': 'Invitation has already been used'}), 401
    
    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    
    password_hash = pbkdf2_sha256.hash(password)
    try:
        cursor.execute('''
            INSERT INTO users (username, email, password_hash)
            VALUES (?, ?, ?)
        ''', (username, email, password_hash))
        
        cursor.execute('UPDATE invitations SET used = TRUE WHERE invite_id = ?', (invite_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'User created successfully'})
    
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)