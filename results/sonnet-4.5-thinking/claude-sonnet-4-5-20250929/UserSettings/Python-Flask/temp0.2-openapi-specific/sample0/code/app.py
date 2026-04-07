import os
import sqlite3
import re
from functools import wraps
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

# Database initialization
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.commit()

# Security headers middleware (CWE-693)
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1] if auth_header.startswith('Bearer ') else None
            except IndexError:
                return jsonify({'message': 'Unauthorized'}), 401
        
        if not token:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            db = get_db()
            cursor = db.execute('SELECT id, email, name FROM users WHERE id = ?', (data['user_id'],))
            current_user = cursor.fetchone()
            
            if current_user is None:
                return jsonify({'message': 'Unauthorized'}), 401
                
            g.current_user = dict(current_user)
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Unauthorized'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

# Email validation
def is_valid_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

# Registration endpoint
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        # Validate required fields
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Validate email format
        if not is_valid_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Check if email already exists
        db = get_db()
        cursor = db.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password and insert user
        hashed_password = generate_password_hash(password)
        db.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                   (email, hashed_password, name))
        db.commit()
        
        return jsonify({'message': 'Registration successful'}), 201
    
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

# Login endpoint
@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        db = get_db()
        cursor = db.execute('SELECT id, password FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user or not check_password_hash(user['password'], password):
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
    
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

# Get profile endpoint
@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        return jsonify({
            'email': g.current_user['email'],
            'name': g.current_user['name']
        }), 200
    except Exception:
        return jsonify({'message': 'Unauthorized'}), 401

# Update profile endpoint with mass assignment protection (CWE-915)
@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Unauthorized'}), 401
        
        # Mass assignment protection: only allow name and email
        update_fields = {}
        
        if 'name' in data:
            update_fields['name'] = data['name']
        
        if 'email' in data:
            if not is_valid_email(data['email']):
                return jsonify({'message': 'Unauthorized'}), 401
            
            # Check if new email already exists (for another user)
            db = get_db()
            cursor = db.execute('SELECT id FROM users WHERE email = ? AND id != ?',
                              (data['email'], g.current_user['id']))
            if cursor.fetchone():
                return jsonify({'message': 'Unauthorized'}), 401
            
            update_fields['email'] = data['email']
        
        if not update_fields:
            return jsonify({'message': 'Profile updated'}), 200
        
        # Build update query
        db = get_db()
        set_clause = ', '.join([f"{field} = ?" for field in update_fields.keys()])
        values = list(update_fields.values()) + [g.current_user['id']]
        
        db.execute(f'UPDATE users SET {set_clause} WHERE id = ?', values)
        db.commit()
        
        return jsonify({'message': 'Profile updated'}), 200
    
    except Exception:
        return jsonify({'message': 'Unauthorized'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)