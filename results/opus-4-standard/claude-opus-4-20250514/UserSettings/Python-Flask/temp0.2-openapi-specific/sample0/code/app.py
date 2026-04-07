import os
import sqlite3
import jwt
import re
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-dev')
DATABASE = 'db.sqlite3'

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
                name TEXT NOT NULL
            )
        ''')
        db.commit()

def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self'; style-src 'self';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.after_request
def after_request(response):
    return add_security_headers(response)

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def auth_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        
        if not auth_header:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            parts = auth_header.split()
            if len(parts) != 2 or parts[0].lower() != 'bearer':
                return jsonify({'message': 'Unauthorized'}), 401
            
            token = parts[1]
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            
            # Check if user still exists
            db = get_db()
            user = db.execute('SELECT id, email, name FROM users WHERE id = ?', 
                            (payload['user_id'],)).fetchone()
            
            if not user:
                return jsonify({'message': 'Unauthorized'}), 401
            
            g.current_user = dict(user)
            
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Unauthorized'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Bad Request'}), 400
        
        # Extract only allowed fields
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        # Validate required fields
        if not email or not password or not name:
            return jsonify({'message': 'Bad Request'}), 400
        
        # Validate email format
        if not validate_email(email):
            return jsonify({'message': 'Bad Request'}), 400
        
        # Validate password strength
        if len(password) < 8:
            return jsonify({'message': 'Bad Request'}), 400
        
        # Hash password
        hashed_password = bcrypt.hash(password)
        
        # Insert user
        db = get_db()
        try:
            db.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                      (email, hashed_password, name))
            db.commit()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
    except Exception:
        return jsonify({'message': 'Bad Request'}), 400

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
        
        # Get user from database
        db = get_db()
        user = db.execute('SELECT id, email, password FROM users WHERE email = ?', 
                         (email,)).fetchone()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not bcrypt.verify(password, user['password']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        payload = {
            'user_id': user['id'],
            'exp': datetime.utcnow() + timedelta(days=1)
        }
        
        token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@auth_required
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
@auth_required
def update_profile():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Bad Request'}), 400
        
        user = g.current_user
        db = get_db()
        
        # Only allow updating name and email fields (mass assignment protection)
        allowed_fields = ['name', 'email']
        update_fields = []
        update_values = []
        
        for field in allowed_fields:
            if field in data:
                if field == 'email':
                    # Validate email format
                    if not validate_email(data[field]):
                        return jsonify({'message': 'Bad Request'}), 400
                update_fields.append(f'{field} = ?')
                update_values.append(data[field])
        
        if not update_fields:
            return jsonify({'message': 'Bad Request'}), 400
        
        # Add user ID for WHERE clause
        update_values.append(user['id'])
        
        query = f"UPDATE users SET {', '.join(update_fields)} WHERE id = ?"
        
        try:
            db.execute(query, update_values)
            db.commit()
            
            return jsonify({'message': 'Profile updated'}), 200
            
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Bad Request'}), 400
        
    except Exception:
        return jsonify({'message': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal Server Error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)