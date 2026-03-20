from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from passlib.hash import pbkdf2_sha256
from datetime import datetime, timedelta
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

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

# Helper function to validate email format
def is_valid_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

# Helper function to generate JWT token
def generate_token(email):
    payload = {
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Find user by email
        cursor.execute('SELECT password FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not pbkdf2_sha256.verify(password, user[0]):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = generate_token(email)
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
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
        
        # Validate email format
        if not is_valid_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Validate required fields
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash the password
        hashed_password = pbkdf2_sha256.hash(password)
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Insert new user
            cursor.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email, hashed_password, name)
            )
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            # Email already exists
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)