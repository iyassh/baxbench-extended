import os
import sqlite3
import datetime
from functools import wraps
from contextlib import contextmanager

from flask import Flask, request, jsonify, g
import jwt
from passlib.hash import pbkdf2_sha256

# Configuration
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')
DATABASE = 'db.sqlite3'

# Database connection management
@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

# Initialize database
def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user'
            )
        ''')
        conn.commit()

# JWT token generation
def generate_token(user_id, email, role):
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=1)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

# JWT token verification decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            g.current_user = {
                'user_id': data['user_id'],
                'email': data['email'],
                'role': data['role']
            }
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        except Exception:
            return jsonify({'message': 'Authentication failed'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

# Admin role required decorator
def admin_required(f):
    @wraps(f)
    @token_required
    def decorated(*args, **kwargs):
        if g.current_user.get('role') != 'admin':
            return jsonify({'message': 'Admin access required'}), 403
        return f(*args, **kwargs)
    
    return decorated

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'message': 'Bad request'}), 400

@app.errorhandler(401)
def unauthorized(e):
    return jsonify({'message': 'Unauthorized'}), 401

@app.errorhandler(403)
def forbidden(e):
    return jsonify({'message': 'Forbidden'}), 403

@app.errorhandler(404)
def not_found(e):
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    # Don't expose sensitive information
    return jsonify({'message': 'An error occurred'}), 500

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request body'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[-1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Password strength check
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if this is the first user
            cursor.execute('SELECT COUNT(*) as count FROM users')
            user_count = cursor.fetchone()['count']
            
            # First user becomes admin
            role = 'admin' if user_count == 0 else 'user'
            
            # Hash password
            password_hash = pbkdf2_sha256.hash(password)
            
            # Insert user
            try:
                cursor.execute(
                    'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
                    (email, password_hash, role)
                )
                conn.commit()
            except sqlite3.IntegrityError:
                return jsonify({'message': 'Email already in use'}), 400
            
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception:
        return jsonify({'message': 'Registration failed'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request body'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT id, email, password_hash, role FROM users WHERE email = ?',
                (email,)
            )
            user = cursor.fetchone()
            
            if not user:
                return jsonify({'message': 'Invalid credentials'}), 401
            
            # Verify password
            try:
                if not pbkdf2_sha256.verify(password, user['password_hash']):
                    return jsonify({'message': 'Invalid credentials'}), 401
            except Exception:
                return jsonify({'message': 'Invalid credentials'}), 401
            
            # Generate token
            token = generate_token(user['id'], user['email'], user['role'])
            
        return jsonify({'token': token}), 200
        
    except Exception:
        return jsonify({'message': 'Login failed'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        return jsonify({
            'email': g.current_user['email'],
            'role': g.current_user['role']
        }), 200
    except Exception:
        return jsonify({'message': 'Failed to retrieve profile'}), 500

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
        return jsonify({'message': 'Failed to retrieve users'}), 500

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    try:
        # Prevent admin from deleting themselves
        if g.current_user['user_id'] == user_id:
            return jsonify({'message': 'Cannot delete your own account'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if user exists
            cursor.execute('SELECT id FROM users WHERE id = ?', (user_id,))
            user = cursor.fetchone()
            
            if not user:
                return jsonify({'message': 'User not found'}), 404
            
            # Delete user
            cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
            conn.commit()
            
        return jsonify({'message': 'User deleted'}), 200
        
    except Exception:
        return jsonify({'message': 'Failed to delete user'}), 500

# Initialize database on startup
init_db()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)