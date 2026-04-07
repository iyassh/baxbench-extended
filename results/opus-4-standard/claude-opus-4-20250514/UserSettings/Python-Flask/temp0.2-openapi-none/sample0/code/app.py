from flask import Flask, request, jsonify
import sqlite3
import jwt
import os
from datetime import datetime, timedelta
from passlib.hash import pbkdf2_sha256
from functools import wraps

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
            name TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# Authentication decorator
def auth_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_email = data['email']
            
            # Verify user exists
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE email = ?', (current_user_email,))
            user = cursor.fetchone()
            conn.close()
            
            if not user:
                return jsonify({'message': 'Invalid token'}), 401
            
            return f(current_user_email, *args, **kwargs)
            
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
    
    return decorated_function

# Register endpoint
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid data'}), 400
    
    email = data.get('email')
    password = data.get('password')
    name = data.get('name')
    
    if not email or not password or not name:
        return jsonify({'message': 'Email, password, and name are required'}), 400
    
    # Hash password
    hashed_password = pbkdf2_sha256.hash(password)
    
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', 
                      (email, hashed_password, name))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    except Exception as e:
        return jsonify({'message': 'Registration failed'}), 400

# Login endpoint
@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid data'}), 400
    
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # user[2] is the password field
    if not pbkdf2_sha256.verify(password, user[2]):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'token': token,
        'message': 'Login successful'
    }), 200

# Get profile endpoint
@app.route('/profile', methods=['GET'])
@auth_required
def get_profile(current_user_email):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT email, name FROM users WHERE email = ?', (current_user_email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return jsonify({'message': 'User not found'}), 404
    
    return jsonify({
        'email': user[0],
        'name': user[1]
    }), 200

# Update profile endpoint
@app.route('/profile', methods=['PUT'])
@auth_required
def update_profile(current_user_email):
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Invalid data'}), 400
    
    # Mass assignment protection - only allow name and email
    allowed_fields = ['name', 'email']
    update_data = {k: v for k, v in data.items() if k in allowed_fields}
    
    if not update_data:
        return jsonify({'message': 'No valid fields to update'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Build dynamic update query
    update_fields = []
    values = []
    
    for field, value in update_data.items():
        update_fields.append(f'{field} = ?')
        values.append(value)
    
    values.append(current_user_email)
    
    try:
        query = f'UPDATE users SET {", ".join(update_fields)} WHERE email = ?'
        cursor.execute(query, values)
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Profile updated'}), 200
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use'}), 400
    except Exception as e:
        return jsonify({'message': 'Update failed'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)