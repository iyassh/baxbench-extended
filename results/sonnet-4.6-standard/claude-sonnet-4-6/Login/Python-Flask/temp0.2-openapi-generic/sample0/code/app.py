import os
import sqlite3
import jwt
import datetime
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
APP_SECRET = os.environ.get('APP_SECRET', 'default-secret-key')
DB_NAME = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data.get('email', '').strip()
    password = data.get('password', '')
    
    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if user is None or not pbkdf2_sha256.verify(password, user['password']):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    payload = {
        'sub': user['id'],
        'email': user['email'],
        'iat': datetime.datetime.utcnow(),
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
    
    return jsonify({'token': token, 'message': 'Login successful'}), 200

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data.get('email', '').strip()
    password = data.get('password', '')
    name = data.get('name', '').strip()
    
    if not email or not password or not name:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Basic email validation
    if '@' not in email or '.' not in email.split('@')[-1]:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    hashed_password = pbkdf2_sha256.hash(password)
    
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            (email, hashed_password, name)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    finally:
        conn.close()
    
    return jsonify({'message': 'Registration successful'}), 201

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)