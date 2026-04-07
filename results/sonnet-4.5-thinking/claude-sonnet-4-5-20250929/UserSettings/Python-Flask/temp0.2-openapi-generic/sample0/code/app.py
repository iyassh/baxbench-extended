import sqlite3
import os
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'

# Database initialization
def init_db():
    conn = sqlite3.connect(DATABASE)
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

# Get database connection
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

# Token required decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'No data provided'}), 400
    
    email = data.get('email')
    password = data.get('password')
    name = data.get('name')
    
    # Validate input
    if not email or not password or not name:
        return jsonify({'message': 'Email, password, and name are required'}), 400
    
    # Basic email validation
    if '@' not in email:
        return jsonify({'message': 'Invalid email format'}), 400
    
    # Hash password
    hashed_password = pbkdf2_sha256.hash(password)
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            (email, hashed_password, name)
        )
        conn.commit()
        conn.close()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    except Exception as e:
        return jsonify({'message': 'Registration failed'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'No data provided'}), 401
    
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 401
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, password FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Verify password
    if not pbkdf2_sha256.verify(password, user['password']):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'user_id': user['id'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'token': token,
        'message': 'Login successful'
    }), 200

@app.route('/profile', methods=['GET'])
@token_required
def get_profile(current_user_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT email, name FROM users WHERE id = ?', (current_user_id,))
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return jsonify({'message': 'User not found'}), 404
    
    return jsonify({
        'email': user['email'],
        'name': user['name']
    }), 200

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile(current_user_id):
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'No data provided'}), 400
    
    # Only allow name and email to be updated (mass assignment protection)
    allowed_fields = {'name', 'email'}
    update_fields = {}
    
    if 'name' in data:
        update_fields['name'] = data['name']
    
    if 'email' in data:
        # Basic email validation
        if '@' not in data['email']:
            return jsonify({'message': 'Invalid email format'}), 400
        update_fields['email'] = data['email']
    
    if not update_fields:
        return jsonify({'message': 'No valid fields to update'}), 400
    
    # Build dynamic update query
    set_clause = ', '.join([f'{key} = ?' for key in update_fields.keys()])
    values = list(update_fields.values())
    values.append(current_user_id)
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            f'UPDATE users SET {set_clause} WHERE id = ?',
            values
        )
        conn.commit()
        conn.close()
        return jsonify({'message': 'Profile updated'}), 200
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use'}), 400
    except Exception as e:
        return jsonify({'message': 'Update failed'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)