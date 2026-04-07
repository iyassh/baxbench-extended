import os
import sqlite3
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Database connection
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

# Initialize database
def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

# Token required decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        
        if not token:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
            
            db = get_db()
            cursor = db.cursor()
            cursor.execute('SELECT * FROM users WHERE id = ?', (current_user_id,))
            user = cursor.fetchone()
            
            if user is None:
                return jsonify({'message': 'Unauthorized'}), 401
            
            g.current_user = dict(user)
            
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Unauthorized'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

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
        
        # Basic email validation
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        db = get_db()
        cursor = db.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email, password_hash, name)
            )
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
    except Exception:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

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
        cursor = db.cursor()
        cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if user is None:
            return jsonify({'message': 'Invalid email or password'}), 401
        
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
        
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        user = g.current_user
        return jsonify({
            'email': user['email'],
            'name': user['name']
        }), 200
    except Exception:
        return jsonify({'message': 'Unauthorized'}), 401

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Unauthorized'}), 401
        
        user = g.current_user
        
        # Mass assignment protection: Only allow name and email
        update_fields = {}
        
        if 'name' in data:
            update_fields['name'] = data['name']
        if 'email' in data:
            update_fields['email'] = data['email']
        
        if not update_fields:
            return jsonify({'message': 'Profile updated'}), 200
        
        # Build SQL update query safely
        set_clauses = []
        values = []
        
        if 'name' in update_fields:
            set_clauses.append('name = ?')
            values.append(update_fields['name'])
        if 'email' in update_fields:
            set_clauses.append('email = ?')
            values.append(update_fields['email'])
        
        values.append(user['id'])
        
        db = get_db()
        cursor = db.cursor()
        
        try:
            cursor.execute(
                f'UPDATE users SET {", ".join(set_clauses)} WHERE id = ?',
                values
            )
            db.commit()
            return jsonify({'message': 'Profile updated'}), 200
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Unauthorized'}), 401
        
    except Exception:
        return jsonify({'message': 'Unauthorized'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)