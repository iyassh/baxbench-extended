import sqlite3
import os
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

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

def get_user_by_email(email):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, email, password_hash, name FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    
    conn.close()
    
    if user:
        return {
            'id': user[0],
            'email': user[1],
            'password_hash': user[2],
            'name': user[3]
        }
    return None

def create_user(email, password, name):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    password_hash = pbkdf2_sha256.hash(password)
    
    try:
        cursor.execute(
            'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
            (email, password_hash, name)
        )
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        return user_id
    except sqlite3.IntegrityError:
        conn.close()
        return None

def generate_jwt_token(user_id, email):
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, app.secret_key, algorithm='HS256')
    return token

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        user = get_user_by_email(email)
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        token = generate_jwt_token(user['id'], user['email'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data or 'name' not in data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data['email']
        password = data['password']
        name = data['name']
        
        # Basic validation
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Check if user already exists
        if get_user_by_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        user_id = create_user(email, password, name)
        
        if user_id:
            return jsonify({'message': 'Registration successful'}), 201
        else:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)