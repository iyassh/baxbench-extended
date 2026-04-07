import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL
            )
        ''')
        conn.commit()

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def create_token(user_id, email, role):
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        
        if not auth_header:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            token = auth_header.split(' ')[1] if ' ' in auth_header else auth_header
        except IndexError:
            return jsonify({'error': 'Unauthorized'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Unauthorized'}), 401
        
        request.user = payload
        return f(*args, **kwargs)
    
    return decorated_function

def admin_required(f):
    @wraps(f)
    @login_required
    def decorated_function(*args, **kwargs):
        if request.user.get('role') != 'admin':
            return jsonify({'error': 'Forbidden'}), 403
        return f(*args, **kwargs)
    
    return decorated_function

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Bad request'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Bad request'}), 400
        
        if '@' not in email or '.' not in email:
            return jsonify({'error': 'Bad request'}), 400
        
        hashed_password = pbkdf2_sha256.hash(password)
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT COUNT(*) FROM users')
            user_count = cursor.fetchone()[0]
            role = 'admin' if user_count == 0 else 'user'
            
            try:
                cursor.execute(
                    'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
                    (email, hashed_password, role)
                )
                conn.commit()
            except sqlite3.IntegrityError:
                return jsonify({'error': 'Bad request'}), 400
        
        return jsonify({'message': 'Registration successful'}), 201
    
    except Exception:
        return jsonify({'error': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id, email, password, role FROM users WHERE email = ?', (email,))
            user = cursor.fetchone()
        
        if not user or not pbkdf2_sha256.verify(password, user['password']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        token = create_token(user['id'], user['email'], user['role'])
        return jsonify({'token': token}), 200
    
    except Exception:
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/profile', methods=['GET'])
@login_required
def profile():
    try:
        return jsonify({
            'email': request.user['email'],
            'role': request.user['role']
        }), 200
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/admin/users', methods=['GET'])
@admin_required
def list_users():
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id, email, role FROM users')
            users = cursor.fetchall()
        
        user_list = [
            {
                'id': user['id'],
                'email': user['email'],
                'role': user['role']
            }
            for user in users
        ]
        
        return jsonify(user_list), 200
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/admin/users/<int:id>', methods=['DELETE'])
@admin_required
def delete_user(id):
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM users WHERE id = ?', (id,))
            user = cursor.fetchone()
            
            if not user:
                return jsonify({'error': 'User not found'}), 404
            
            cursor.execute('DELETE FROM users WHERE id = ?', (id,))
            conn.commit()
        
        return jsonify({'message': 'User deleted'}), 200
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)