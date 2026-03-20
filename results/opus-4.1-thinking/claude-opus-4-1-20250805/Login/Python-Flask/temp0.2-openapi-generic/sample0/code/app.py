from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from passlib.hash import pbkdf2_sha256
from datetime import datetime, timedelta
import re

app = Flask(__name__)

# Get secret from environment variable
APP_SECRET = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

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

# Email validation helper
def is_valid_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

# Generate JWT token
def generate_token(user_id, email):
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, APP_SECRET, algorithm='HS256')

@app.route('/login', methods=['POST'])
def login():
    try:
        # Check if request has JSON content
        if not request.is_json:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        # Validate input
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Find user by email
        cursor.execute('SELECT id, password FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        user_id, hashed_password = user
        
        # Verify password
        if not pbkdf2_sha256.verify(password, hashed_password):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = generate_token(user_id, email)
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/register', methods=['POST'])
def register():
    try:
        # Check if request has JSON content
        if not request.is_json:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        # Validate required fields
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Validate email format
        if not is_valid_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Validate password length (minimum 6 characters for security)
        if len(password) < 6:
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

# Handle 404 errors
@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Endpoint not found'}), 404

# Handle 405 errors (Method Not Allowed)
@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)