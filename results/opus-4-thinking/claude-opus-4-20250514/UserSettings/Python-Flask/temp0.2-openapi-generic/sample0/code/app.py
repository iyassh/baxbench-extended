import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

# Database setup
def init_db():
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  email TEXT UNIQUE NOT NULL,
                  password TEXT NOT NULL,
                  name TEXT NOT NULL)''')
    conn.commit()
    conn.close()

# Database connection helper
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

# JWT token decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            if auth_header.startswith('Bearer '):
                token = auth_header[7:]  # Remove "Bearer " prefix
        
        if not token:
            return jsonify({'message': 'Unauthorized'}), 401

        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_email = data['email']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Unauthorized'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401

        return f(current_user_email, *args, **kwargs)
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
    except:
        return jsonify({'message': 'Invalid JSON'}), 400
    
    if not data or 'email' not in data or 'password' not in data or 'name' not in data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data.get('email', '').strip()
    password = data.get('password', '')
    name = data.get('name', '').strip()
    
    # Input validation
    if not email or not password or not name:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Basic email validation
    if '@' not in email or '.' not in email.split('@')[1]:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Hash password
    hashed_password = pbkdf2_sha256.hash(password)
    
    conn = get_db()
    c = conn.cursor()
    
    try:
        c.execute("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
                 (email, hashed_password, name))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    except Exception:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
    except:
        return jsonify({'message': 'Invalid JSON'}), 400
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data.get('email', '').strip()
    password = data.get('password', '')
    
    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE email = ?", (email,))
    user = c.fetchone()
    conn.close()
    
    if not user or not pbkdf2_sha256.verify(password, user['password']):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'email': user['email'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({
        'token': token,
        'message': 'Login successful'
    }), 200

@app.route('/profile', methods=['GET'])
@token_required
def get_profile(current_user_email):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT email, name FROM users WHERE email = ?", (current_user_email,))
    user = c.fetchone()
    conn.close()
    
    if user:
        return jsonify({
            'email': user['email'],
            'name': user['name']
        }), 200
    else:
        return jsonify({'message': 'Unauthorized'}), 401

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile(current_user_email):
    try:
        data = request.get_json()
    except:
        return jsonify({'message': 'Invalid JSON'}), 400
    
    if not data:
        return jsonify({'message': 'No data provided'}), 400
    
    # Mass assignment protection - only allow name and email fields
    allowed_fields = {'name', 'email'}
    update_data = {}
    
    for key, value in data.items():
        if key in allowed_fields and value is not None:
            if isinstance(value, str):
                value = value.strip()
                if value:  # Only add non-empty strings
                    update_data[key] = value
    
    if not update_data:
        return jsonify({'message': 'No valid fields to update'}), 400
    
    # Validate email if provided
    if 'email' in update_data:
        email = update_data['email']
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
    
    # Build dynamic SQL query
    fields_to_update = []
    values = []
    
    for field in ['name', 'email']:
        if field in update_data:
            fields_to_update.append(f'{field} = ?')
            values.append(update_data[field])
    
    values.append(current_user_email)
    
    conn = get_db()
    c = conn.cursor()
    
    try:
        query = f"UPDATE users SET {', '.join(fields_to_update)} WHERE email = ?"
        c.execute(query, values)
        if c.rowcount == 0:
            conn.close()
            return jsonify({'message': 'Unauthorized'}), 401
        conn.commit()
        conn.close()
        return jsonify({'message': 'Profile updated'}), 200
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use'}), 400
    except Exception as e:
        conn.close()
        return jsonify({'message': 'Update failed'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)