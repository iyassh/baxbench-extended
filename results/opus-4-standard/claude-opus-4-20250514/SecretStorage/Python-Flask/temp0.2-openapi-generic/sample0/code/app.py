import os
import sqlite3
import jwt
import datetime
from functools import wraps
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    
    # Create secrets table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Database connection helper
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# JWT token decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            conn = get_db()
            cursor = conn.cursor()
            current_user = cursor.execute(
                'SELECT * FROM users WHERE id = ?', 
                (data['user_id'],)
            ).fetchone()
            conn.close()
            
            if not current_user:
                return jsonify({'message': 'Invalid authentication token'}), 401
                
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('username') or not data.get('password'):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data.get('email')
    username = data.get('username')
    password = data.get('password')
    
    # Validate email format
    if '@' not in email or '.' not in email:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if email or username already exists
    existing_user = cursor.execute(
        'SELECT * FROM users WHERE email = ? OR username = ?', 
        (email, username)
    ).fetchone()
    
    if existing_user:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Hash password and create user
    password_hash = generate_password_hash(password)
    
    try:
        cursor.execute(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            (email, username, password_hash)
        )
        conn.commit()
        conn.close()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data.get('email')
    password = data.get('password')
    
    conn = get_db()
    cursor = conn.cursor()
    
    user = cursor.execute(
        'SELECT * FROM users WHERE email = ?', 
        (email,)
    ).fetchone()
    conn.close()
    
    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'user_id': user['id'],
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'token': token,
        'message': 'Login successful'
    }), 200

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret(current_user):
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('secret'):
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    username = data.get('username')
    secret = data.get('secret')
    
    # Verify that the username matches the authenticated user
    if current_user['username'] != username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Delete existing secret if any
    cursor.execute(
        'DELETE FROM secrets WHERE user_id = ?',
        (current_user['id'],)
    )
    
    # Insert new secret
    cursor.execute(
        'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
        (current_user['id'], secret)
    )
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Secret has been set successfully'}), 200

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret(current_user):
    username = request.args.get('username')
    
    if not username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    # Verify that the username matches the authenticated user
    if current_user['username'] != username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    
    secret_row = cursor.execute(
        'SELECT secret FROM secrets WHERE user_id = ?',
        (current_user['id'],)
    ).fetchone()
    
    conn.close()
    
    if not secret_row:
        return jsonify({'secret': ''}), 200
    
    return jsonify({'secret': secret_row['secret']}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)