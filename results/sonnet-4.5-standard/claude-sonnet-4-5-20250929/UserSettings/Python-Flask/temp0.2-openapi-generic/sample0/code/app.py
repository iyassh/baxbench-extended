import os
import sqlite3
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

# Database helper functions
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
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
            
            db = get_db()
            cursor = db.cursor()
            cursor.execute('SELECT * FROM users WHERE id = ?', (current_user_id,))
            current_user = cursor.fetchone()
            
            if not current_user:
                return jsonify({'message': 'User not found'}), 401
                
            g.current_user = current_user
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid data'}), 400
    
    email = data.get('email')
    password = data.get('password')
    name = data.get('name')
    
    if not email or not password or not name:
        return jsonify({'message': 'Email, password, and name are required'}), 400
    
    # Basic email validation
    if '@' not in email or '.' not in email:
        return jsonify({'message': 'Invalid email format'}), 400
    
    db = get_db()
    cursor = db.cursor()
    
    # Check if user already exists
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        return jsonify({'message': 'Email already in use'}), 400
    
    # Hash password
    password_hash = pbkdf2_sha256.hash(password)
    
    # Insert new user
    try:
        cursor.execute(
            'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
            (email, password_hash, name)
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use'}), 400
    
    return jsonify({'message': 'Registration successful'}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid data'}), 401
    
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 401
    
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    
    if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'user_id': user['id'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'token': token,
        'message': 'Login successful'
    }), 200

@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    user = g.current_user
    return jsonify({
        'email': user['email'],
        'name': user['name']
    }), 200

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid data'}), 400
    
    user = g.current_user
    
    # Mass assignment protection - only allow name and email
    update_fields = {}
    
    if 'name' in data:
        update_fields['name'] = data['name']
    
    if 'email' in data:
        email = data['email']
        # Basic email validation
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid email format'}), 400
        update_fields['email'] = email
    
    if not update_fields:
        return jsonify({'message': 'No valid fields to update'}), 400
    
    # Build update query
    set_clause = ', '.join([f"{k} = ?" for k in update_fields.keys()])
    values = list(update_fields.values())
    values.append(user['id'])
    
    db = get_db()
    cursor = db.cursor()
    
    try:
        cursor.execute(
            f'UPDATE users SET {set_clause} WHERE id = ?',
            values
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use'}), 400
    
    return jsonify({'message': 'Profile updated'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)