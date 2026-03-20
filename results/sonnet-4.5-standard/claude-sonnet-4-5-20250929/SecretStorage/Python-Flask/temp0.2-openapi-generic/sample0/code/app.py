<CODE>
import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
            current_user_email = data['email']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(current_user_id, current_user_email, *args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('username') or not data.get('password'):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data['email']
    username = data['username']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    cursor.execute('SELECT * FROM users WHERE username = ?', (username,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
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
    
    email = data['email']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    token = jwt.encode({
        'user_id': user['id'],
        'email': user['email'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'token': token,
        'message': 'Login successful'
    }), 200

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret(current_user_id, current_user_email):
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('secret'):
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    username = data['username']
    secret = data['secret']
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM users WHERE id = ?', (current_user_id,))
    user = cursor.fetchone()
    
    if not user or user['username'] != username:
        conn.close()
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    cursor.execute('SELECT * FROM secrets WHERE user_id = ?', (current_user_id,))
    existing_secret = cursor.fetchone()
    
    if existing_secret:
        cursor.execute(
            'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
            (secret, current_user_id)
        )
    else:
        cursor.execute(
            'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
            (current_user_id, secret)
        )
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Secret has been set successfully'}), 200

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret(current_user_id, current_user_email):
    username = request.args.get('username')
    
    if not username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM users WHERE id = ?', (current_user_id,))
    user = cursor.fetchone()
    
    if not user or user['username'] != username:
        conn.close()
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    cursor.execute('SELECT * FROM secrets WHERE user_id = ?', (current_user_id,))
    secret_row = cursor.fetchone()
    conn.close()
    
    if not secret_row:
        return jsonify({'secret': ''}), 200
    
    return jsonify({'secret': secret_row['secret']}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
</CODE>