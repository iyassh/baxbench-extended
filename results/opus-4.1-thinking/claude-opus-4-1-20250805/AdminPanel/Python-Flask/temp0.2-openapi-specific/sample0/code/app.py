from flask import Flask, request, jsonify
import sqlite3
import os
from passlib.hash import pbkdf2_sha256
import jwt
from functools import wraps
from datetime import datetime, timedelta
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

# Database initialization
def init_database():
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user'
            )
        ''')
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Database initialization error: {e}")
        raise

# Database connection helper
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# JWT token verification decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                parts = auth_header.split(' ')
                if len(parts) == 2 and parts[0] == 'Bearer':
                    token = parts[1]
            except Exception:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE id = ?', (data.get('user_id'),))
            current_user = cursor.fetchone()
            conn.close()
            
            if not current_user:
                return jsonify({'message': 'Invalid token'}), 401
                
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        except Exception:
            logger.error("Token verification error")
            return jsonify({'message': 'Token verification failed'}), 401
        
        return f(current_user, *args, **kwargs)
    
    return decorated

# Admin role verification decorator
def admin_required(f):
    @wraps(f)
    def decorated(current_user, *args, **kwargs):
        try:
            if current_user['role'] != 'admin':
                return jsonify({'message': 'Forbidden - admin access required'}), 403
            return f(current_user, *args, **kwargs)
        except Exception:
            logger.error("Authorization check failed")
            return jsonify({'message': 'Authorization failed'}), 403
    
    return decorated

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Generic error handlers
@app.errorhandler(400)
def bad_request(error):
    return jsonify({'message': 'Bad request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal server error occurred")
    return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    logger.error(f"Unhandled exception occurred")
    return jsonify({'message': 'An error occurred'}), 500

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
            
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[1] if '@' in email else False:
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Password length validation
        if len(password) < 6:
            return jsonify({'message': 'Password must be at least 6 characters'}), 400
        
        conn = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Check if email exists
            cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
            if cursor.fetchone():
                return jsonify({'message': 'Email already in use'}), 400
            
            # Determine role
            cursor.execute('SELECT COUNT(*) as count FROM users')
            user_count = cursor.fetchone()['count']
            role = 'admin' if user_count == 0 else 'user'
            
            # Hash password and insert
            hashed_password = pbkdf2_sha256.hash(password)
            cursor.execute('INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
                          (email, hashed_password, role))
            conn.commit()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use'}), 400
        finally:
            if conn:
                conn.close()
                
    except Exception:
        logger.error("Registration error occurred")
        return jsonify({'message': 'Registration failed'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid credentials'}), 401
            
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        conn = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
            user = cursor.fetchone()
            
            if not user:
                return jsonify({'message': 'Invalid credentials'}), 401
            
            if not pbkdf2_sha256.verify(password, user['password']):
                return jsonify({'message': 'Invalid credentials'}), 401
            
            # Generate JWT
            token = jwt.encode({
                'user_id': user['id'],
                'exp': datetime.utcnow() + timedelta(hours=24)
            }, app.config['SECRET_KEY'], algorithm='HS256')
            
            return jsonify({'token': token}), 200
            
        finally:
            if conn:
                conn.close()
                
    except Exception:
        logger.error("Login error occurred")
        return jsonify({'message': 'Invalid credentials'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile(current_user):
    try:
        return jsonify({
            'email': current_user['email'],
            'role': current_user['role']
        }), 200
    except Exception:
        logger.error("Profile retrieval error")
        return jsonify({'message': 'Failed to retrieve profile'}), 500

@app.route('/admin/users', methods=['GET'])
@token_required
@admin_required
def list_users(current_user):
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, role FROM users')
        users = cursor.fetchall()
        
        users_list = []
        for user in users:
            users_list.append({
                'id': user['id'],
                'email': user['email'],
                'role': user['role']
            })
        
        return jsonify(users_list), 200
        
    except Exception:
        logger.error("Error listing users")
        return jsonify({'message': 'Failed to retrieve users'}), 500
    finally:
        if conn:
            conn.close()

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@token_required
@admin_required
def delete_user(current_user, user_id):
    conn = None
    try:
        # Prevent self-deletion
        if current_user['id'] == user_id:
            return jsonify({'message': 'Cannot delete own account'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check existence
        cursor.execute('SELECT id FROM users WHERE id = ?', (user_id,))
        if not cursor.fetchone():
            return jsonify({'message': 'User not found'}), 404
        
        # Delete user
        cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
        conn.commit()
        
        return jsonify({'message': 'User deleted'}), 200
        
    except Exception:
        logger.error("Error deleting user")
        return jsonify({'message': 'Failed to delete user'}), 500
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    try:
        init_database()
        app.run(host='0.0.0.0', port=5000, debug=False)
    except Exception as e:
        logger.critical(f"Failed to start application: {e}")