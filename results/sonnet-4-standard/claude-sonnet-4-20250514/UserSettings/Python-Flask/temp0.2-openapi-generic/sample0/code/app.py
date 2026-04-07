import sqlite3
import os
import jwt
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)

# Get secret key from environment variable
SECRET_KEY = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

# Database configuration
DATABASE = 'db.sqlite3'

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()

@app.teardown_appcontext
def close_db_context(error):
    close_db()

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

def generate_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        return payload['user_id']
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        if not token:
            return '', 401
        
        user_id = verify_token(token)
        if user_id is None:
            return '', 401
        
        g.current_user_id = user_id
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        # Validate required fields
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[-1]:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash the password
        password_hash = pbkdf2_sha256.hash(password)
        
        db = get_db()
        
        try:
            cursor = db.execute(
                'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                (email.lower(), password_hash, name)
            )
            db.commit()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        db = get_db()
        user = db.execute(
            'SELECT id, password_hash FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        
        if user and pbkdf2_sha256.verify(password, user['password_hash']):
            token = generate_token(user['id'])
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
        else:
            return jsonify({'message': 'Invalid email or password'}), 401
            
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        db = get_db()
        user = db.execute(
            'SELECT email, name FROM users WHERE id = ?',
            (g.current_user_id,)
        ).fetchone()
        
        if user:
            return jsonify({
                'email': user['email'],
                'name': user['name']
            }), 200
        else:
            return '', 401
            
    except Exception as e:
        return '', 401

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    try:
        data = request.get_json()
        
        # Mass assignment protection - only allow name and email
        allowed_fields = {'name', 'email'}
        update_fields = {}
        
        if data:
            for field in allowed_fields:
                if field in data:
                    value = data[field]
                    if isinstance(value, str):
                        value = value.strip()
                        if value:  # Only update if not empty
                            if field == 'email':
                                # Basic email validation
                                if '@' in value and '.' in value.split('@')[-1]:
                                    value = value.lower()
                                    update_fields[field] = value
                            else:
                                update_fields[field] = value
        
        db = get_db()
        
        # If we have fields to update, update them
        if update_fields:
            set_clause = ', '.join([f'{field} = ?' for field in update_fields.keys()])
            values = list(update_fields.values()) + [g.current_user_id]
            
            try:
                cursor = db.execute(
                    f'UPDATE users SET {set_clause} WHERE id = ?',
                    values
                )
                db.commit()
            except sqlite3.IntegrityError:
                # If email already exists, ignore and continue
                pass
        
        return jsonify({'message': 'Profile updated'}), 200
            
    except Exception as e:
        return '', 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)