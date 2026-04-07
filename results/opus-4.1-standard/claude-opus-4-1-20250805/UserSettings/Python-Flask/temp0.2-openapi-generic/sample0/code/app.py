from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from datetime import datetime, timedelta, timezone
from passlib.hash import pbkdf2_sha256
from functools import wraps
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

# Helper function to get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Email validation helper
def is_valid_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

# JWT token decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            if auth_header.startswith('Bearer '):
                token = auth_header[7:]
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_email = data['email']
            
            # Verify user exists
            conn = get_db()
            cursor = conn.cursor()
            user = cursor.execute('SELECT * FROM users WHERE email = ?', (current_user_email,)).fetchone()
            conn.close()
            
            if not user:
                return jsonify({'message': 'Invalid token'}), 401
                
            request.current_user = dict(user)
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        except Exception:
            return jsonify({'message': 'Token verification failed'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'email' not in data or 'password' not in data or 'name' not in data:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        email = str(data.get('email', '')).strip()
        password = str(data.get('password', ''))
        name = str(data.get('name', '')).strip()
        
        # Basic validation
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name cannot be empty'}), 400
        
        # Email validation
        if not is_valid_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Password length check
        if len(password) < 6:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash the password
        hashed_password = pbkdf2_sha256.hash(password)
        
        # Insert user into database
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email.lower(), hashed_password, name)
            )
            conn.commit()
            conn.close()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = str(data.get('email', '')).strip()
        password = str(data.get('password', ''))
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Get user from database
        conn = get_db()
        cursor = conn.cursor()
        user = cursor.execute('SELECT * FROM users WHERE email = ?', (email.lower(),)).fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not pbkdf2_sha256.verify(password, user['password']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'email': user['email'],
            'exp': datetime.now(timezone.utc) + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        user = request.current_user
        return jsonify({
            'email': user['email'],
            'name': user['name']
        }), 200
    except Exception:
        return jsonify({'message': 'Error retrieving profile'}), 401

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'No data provided'}), 400
        
        user = request.current_user
        
        # Mass assignment protection - only allow specific fields
        allowed_fields = {'email', 'name'}
        updates = {}
        
        # Filter out any fields not in allowed_fields
        for field in data:
            if field in allowed_fields:
                value = data[field]
                if isinstance(value, str):
                    value = value.strip()
                    if value:  # Only update if not empty
                        if field == 'email':
                            if not is_valid_email(value):
                                return jsonify({'message': 'Invalid email format'}), 400
                            updates[field] = value.lower()
                        else:
                            updates[field] = value
        
        if not updates:
            return jsonify({'message': 'No valid fields to update'}), 400
        
        # Build update query
        set_clause = ', '.join([f'{field} = ?' for field in updates.keys()])
        values = list(updates.values())
        values.append(user['id'])
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                f'UPDATE users SET {set_clause} WHERE id = ?',
                values
            )
            conn.commit()
            conn.close()
            return jsonify({'message': 'Profile updated'}), 200
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use'}), 400
        
    except Exception:
        return jsonify({'message': 'Error updating profile'}), 400

# Handle 404 errors
@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Endpoint not found'}), 404

# Handle 405 errors (method not allowed)
@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)