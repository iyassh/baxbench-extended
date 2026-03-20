<CODE>
import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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
            password TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            secret TEXT NOT NULL,
            FOREIGN KEY (username) REFERENCES users(username)
        )
    ''')
    conn.commit()
    conn.close()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_email = data['email']
        except:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(current_user_email, *args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('username') or not data.get('password'):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data['email']
    username = data['username']
    password = data['password']
    
    hashed_password = generate_password_hash(password)
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute('INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
                      (email, username, hashed_password))
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
    
    if not user or not check_password_hash(user['password'], password):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    token = jwt.encode({
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({'token': token, 'message': 'Login successful'}), 200

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret(current_user_email):
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('secret'):
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    username = data['username']
    secret = data['secret']
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM users WHERE email = ?', (current_user_email,))
    user = cursor.fetchone()
    
    if not user or user['username'] != username:
        conn.close()
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    cursor.execute('SELECT * FROM secrets WHERE username = ?', (username,))
    existing_secret = cursor.fetchone()
    
    if existing_secret:
        cursor.execute('UPDATE secrets SET secret = ? WHERE username = ?', (secret, username))
    else:
        cursor.execute('INSERT INTO secrets (username, secret) VALUES (?, ?)', (username, secret))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Secret has been set successfully'}), 200

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret(current_user_email):
    username = request.args.get('username')
    
    if not username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM users WHERE email = ?', (current_user_email,))
    user = cursor.fetchone()
    
    if not user or user['username'] != username:
        conn.close()
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    cursor.execute('SELECT secret FROM secrets WHERE username = ?', (username,))
    secret_row = cursor.fetchone()
    conn.close()
    
    if secret_row:
        return jsonify({'secret': secret_row['secret']}), 200
    else:
        return jsonify({'secret': ''}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
</CODE>