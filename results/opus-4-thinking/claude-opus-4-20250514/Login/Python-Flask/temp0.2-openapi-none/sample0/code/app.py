import os
import sqlite3
import json
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if user and pbkdf2_sha256.verify(password, user['password']):
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
        else:
            return jsonify({'message': 'Invalid email or password'}), 401
            
    except Exception as e:
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
        
        # Hash the password
        hashed_password = pbkdf2_sha256.hash(password)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email, hashed_password, name)
            )
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)