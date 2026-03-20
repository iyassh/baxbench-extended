import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

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
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data.get('email')
    password = data.get('password')
    name = data.get('name')
    
    if not email or not password or not name:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    password_hash = pbkdf2_sha256.hash(password)
    
    try:
        cursor.execute('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                      (email, password_hash, name))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Registration successful'}), 201
    except Exception:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, email, password_hash, name FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    if not pbkdf2_sha256.verify(password, user['password_hash']):
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

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)