from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from datetime import datetime, timedelta
from passlib.hash import bcrypt

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
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    
    # Validate required fields
    if not email or not password or not name:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Basic email validation
    if '@' not in email or '.' not in email:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if email already exists
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        # Insert new user
        cursor.execute(
            'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
            (email, password_hash, name)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    except Exception as e:
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
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get user by email
        cursor.execute('SELECT id, email, password_hash, name FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not bcrypt.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token_payload = {
            'user_id': user['id'],
            'email': user['email'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(token_payload, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)