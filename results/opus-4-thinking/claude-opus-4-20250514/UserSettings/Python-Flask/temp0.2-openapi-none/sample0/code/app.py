import os
import sqlite3
import json
from functools import wraps
from datetime import datetime, timedelta

from flask import Flask, request, jsonify
from passlib.hash import bcrypt
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db_connection() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                # Bearer token format: "Bearer <token>"
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_email = data['email']
            
            # Verify user still exists
            conn = get_db_connection()
            user = conn.execute('SELECT * FROM users WHERE email = ?', (current_user_email,)).fetchone()
            conn.close()
            
            if not user:
                return jsonify({'message': 'Invalid token'}), 401
            
            return f(dict(user), *args, **kwargs)
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or not all(k in data for k in ['email', 'password', 'name']):
            return jsonify({'message': 'Missing required fields'}), 400
        
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        # Basic validation
        if not email or not password or not name:
            return jsonify({'message': 'All fields are required'}), 400
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        # Insert user into database
        conn = get_db_connection()
        try:
            conn.execute(
                'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                (email, password_hash, name)
            )
            conn.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or not all(k in data for k in ['email', 'password']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        # Get user from database
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()
        
        if not user or not bcrypt.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token_data = {
            'email': user['email'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(token_data, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile(current_user):
    return jsonify({
        'email': current_user['email'],
        'name': current_user['name']
    }), 200

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile(current_user):
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'No data provided'}), 400
        
        # Only allow name and email updates (mass assignment protection)
        allowed_fields = ['name', 'email']
        updates = {}
        
        for field in allowed_fields:
            if field in data and data[field]:
                updates[field] = data[field]
        
        if not updates:
            return jsonify({'message': 'No valid fields to update'}), 400
        
        # Build update query
        update_parts = []
        update_values = []
        for field, value in updates.items():
            update_parts.append(f'{field} = ?')
            update_values.append(value)
        update_values.append(current_user['id'])
        
        query = f"UPDATE users SET {', '.join(update_parts)} WHERE id = ?"
        
        conn = get_db_connection()
        try:
            conn.execute(query, update_values)
            conn.commit()
            return jsonify({'message': 'Profile updated'}), 200
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use'}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'message': 'Failed to update profile'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)