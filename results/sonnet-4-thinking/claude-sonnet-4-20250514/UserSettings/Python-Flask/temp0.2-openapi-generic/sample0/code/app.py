import os
import sqlite3
import re
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify
from passlib.hash import bcrypt
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Get token from Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                if auth_header.startswith('Bearer '):
                    token = auth_header[7:]  # Remove "Bearer " prefix
                else:
                    return jsonify({'message': 'Unauthorized'}), 401
            except:
                return jsonify({'message': 'Unauthorized'}), 401
        
        if not token:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            # Decode token
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
            
            # Get user from database
            conn = get_db_connection()
            user = conn.execute('SELECT * FROM users WHERE id = ?', (current_user_id,)).fetchone()
            conn.close()
            
            if user is None:
                return jsonify({'message': 'Unauthorized'}), 401
                
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Unauthorized'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

# Helper functions
def generate_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Extract only allowed fields (mass assignment protection)
        email = data.get('email', '').strip() if data.get('email') else ''
        password = data.get('password', '') if data.get('password') else ''
        name = data.get('name', '').strip() if data.get('name') else ''
        
        # Validation
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        # Save to database
        conn = get_db_connection()
        try:
            conn.execute(
                'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                (email, password_hash, name)
            )
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip() if data.get('email') else ''
        password = data.get('password', '') if data.get('password') else ''
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Get user from database
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()
        
        if user and bcrypt.verify(password, user['password_hash']):
            token = generate_token(user['id'])
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
        else:
            return jsonify({'message': 'Invalid email or password'}), 401
            
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile(current_user_id):
    try:
        conn = get_db_connection()
        user = conn.execute('SELECT email, name FROM users WHERE id = ?', (current_user_id,)).fetchone()
        conn.close()
        
        if user:
            return jsonify({
                'email': user['email'],
                'name': user['name']
            }), 200
        else:
            return jsonify({'message': 'Unauthorized'}), 401
            
    except Exception:
        return jsonify({'message': 'Unauthorized'}), 401

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile(current_user_id):
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Profile updated'}), 200
        
        # Extract only allowed fields (mass assignment protection)
        updates = []
        params = []
        
        if 'name' in data:
            name = data['name'].strip() if data['name'] else ''
            if name:
                updates.append('name = ?')
                params.append(name)
        
        if 'email' in data:
            email = data['email'].strip() if data['email'] else ''
            if email:
                if not validate_email(email):
                    return jsonify({'message': 'Unauthorized'}), 401
                updates.append('email = ?')
                params.append(email)
        
        if updates:
            params.append(current_user_id)
            
            # Update database
            conn = get_db_connection()
            try:
                conn.execute(
                    f'UPDATE users SET {", ".join(updates)} WHERE id = ?',
                    params
                )
                conn.commit()
                conn.close()
                
            except sqlite3.IntegrityError:
                conn.close()
                return jsonify({'message': 'Unauthorized'}), 401
        
        return jsonify({'message': 'Profile updated'}), 200
        
    except Exception:
        return jsonify({'message': 'Unauthorized'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)