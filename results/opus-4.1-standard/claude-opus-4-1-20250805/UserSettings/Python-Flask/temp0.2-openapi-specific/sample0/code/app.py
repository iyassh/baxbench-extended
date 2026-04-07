import os
import sqlite3
import re
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify, g
from werkzeug.exceptions import HTTPException
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key-for-development')
DATABASE = 'db.sqlite3'

# Initialize database
def init_db():
    try:
        conn = sqlite3.connect(DATABASE)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL
            )
        ''')
        conn.commit()
        conn.close()
    except Exception:
        pass  # Silently handle initialization errors

def get_db():
    if not hasattr(g, 'sqlite_db'):
        g.sqlite_db = sqlite3.connect(DATABASE)
        g.sqlite_db.row_factory = sqlite3.Row
    return g.sqlite_db

@app.teardown_appcontext
def close_db(error):
    if hasattr(g, 'sqlite_db'):
        try:
            g.sqlite_db.close()
        except:
            pass

# Add security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Generic error handler
@app.errorhandler(Exception)
def handle_exception(e):
    if isinstance(e, HTTPException):
        return jsonify({'message': 'An error occurred'}), e.code
    return jsonify({'message': 'An internal error occurred'}), 500

def validate_email(email):
    try:
        if not email or not isinstance(email, str):
            return False
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return re.match(pattern, email) is not None
    except:
        return False

def validate_password(password):
    try:
        if not password or not isinstance(password, str):
            return False
        return len(password) >= 8
    except:
        return False

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        try:
            auth_header = request.headers.get('Authorization')
            if auth_header and isinstance(auth_header, str):
                parts = auth_header.split()
                if len(parts) == 2 and parts[0].lower() == 'bearer':
                    token = parts[1]
        except:
            return jsonify({'message': 'Invalid authorization header'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            
            db = get_db()
            cursor = db.cursor()
            cursor.execute('SELECT * FROM users WHERE id = ?', (data.get('user_id'),))
            current_user = cursor.fetchone()
            
            if not current_user:
                return jsonify({'message': 'Invalid token'}), 401
            
            g.current_user = current_user
            
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except (jwt.InvalidTokenError, KeyError, TypeError):
            return jsonify({'message': 'Invalid token'}), 401
        except:
            return jsonify({'message': 'Authentication failed'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        # Get JSON data
        try:
            data = request.get_json(force=True)
        except:
            return jsonify({'message': 'Invalid data'}), 400
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid data'}), 400
        
        # Mass assignment protection - only accept specific fields
        allowed_fields = {'email', 'password', 'name'}
        email = data.get('email', '').strip() if isinstance(data.get('email'), str) else ''
        password = data.get('password', '') if isinstance(data.get('password'), str) else ''
        name = data.get('name', '').strip() if isinstance(data.get('name'), str) else ''
        
        # Validate required fields
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if len(name) < 1 or len(name) > 100:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        try:
            hashed_password = pbkdf2_sha256.hash(password)
        except:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Insert user into database
        try:
            db = get_db()
            cursor = db.cursor()
            cursor.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email.lower(), hashed_password, name)
            )
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        except:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        # Get JSON data
        try:
            data = request.get_json(force=True)
        except:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Mass assignment protection
        email = data.get('email', '').strip() if isinstance(data.get('email'), str) else ''
        password = data.get('password', '') if isinstance(data.get('password'), str) else ''
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Get user from database
        try:
            db = get_db()
            cursor = db.cursor()
            cursor.execute('SELECT * FROM users WHERE email = ?', (email.lower(),))
            user = cursor.fetchone()
        except:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        try:
            if not pbkdf2_sha256.verify(password, user['password']):
                return jsonify({'message': 'Invalid email or password'}), 401
        except:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        try:
            token = jwt.encode({
                'user_id': user['id'],
                'exp': datetime.utcnow() + timedelta(hours=24)
            }, app.config['SECRET_KEY'], algorithm='HS256')
            
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
        except:
            return jsonify({'message': 'Invalid email or password'}), 401
        
    except:
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
    except:
        return jsonify({'message': 'Unable to retrieve profile'}), 500

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    try:
        # Get JSON data
        try:
            data = request.get_json(force=True)
        except:
            return jsonify({'message': 'Invalid data'}), 400
        
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid data'}), 400
        
        user = g.current_user
        
        # Mass assignment protection - only accept name and email fields
        updates = {}
        
        # Only process allowed fields
        if 'name' in data and isinstance(data['name'], str):
            name = data['name'].strip()
            if len(name) < 1 or len(name) > 100:
                return jsonify({'message': 'Invalid data'}), 400
            updates['name'] = name
        
        if 'email' in data and isinstance(data['email'], str):
            email = data['email'].strip()
            if not validate_email(email):
                return jsonify({'message': 'Invalid data'}), 400
            updates['email'] = email.lower()
        
        if not updates:
            return jsonify({'message': 'Profile updated'}), 200
        
        # Build update query
        try:
            db = get_db()
            cursor = db.cursor()
            
            set_clauses = []
            values = []
            
            for field, value in updates.items():
                if field in ['name', 'email']:  # Extra check for allowed fields
                    set_clauses.append(f'{field} = ?')
                    values.append(value)
            
            if set_clauses:
                values.append(user['id'])
                cursor.execute(
                    f"UPDATE users SET {', '.join(set_clauses)} WHERE id = ?",
                    values
                )
                db.commit()
            
            return jsonify({'message': 'Profile updated'}), 200
            
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use'}), 400
        except:
            return jsonify({'message': 'Unable to update profile'}), 400
            
    except:
        return jsonify({'message': 'Unable to update profile'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)