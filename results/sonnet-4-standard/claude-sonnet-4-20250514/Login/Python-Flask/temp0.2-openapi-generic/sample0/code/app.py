import os
import sqlite3
import hashlib
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import re

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
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    return len(password) >= 6

def generate_jwt_token(user_id, email):
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid JSON data'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user or not pbkdf2_sha256.verify(password, user[2]):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        token = generate_jwt_token(user[0], user[1])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid JSON data'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Password must be at least 6 characters long'}), 400
        
        if len(name) < 1 or len(name) > 100:
            return jsonify({'message': 'Name must be between 1 and 100 characters'}), 400
        
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                         (email, password_hash, name))
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
    except Exception as e:
        return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)