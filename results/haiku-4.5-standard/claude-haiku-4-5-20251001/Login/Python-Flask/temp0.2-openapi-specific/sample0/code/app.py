import os
import sqlite3
import jwt
import json
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

# Security configuration
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-insecure-key-change-in-production')
if app.config['SECRET_KEY'] == 'default-insecure-key-change-in-production':
    raise ValueError("APP_SECRET environment variable must be set for production")

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Database initialization
DB_PATH = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create failed login attempts table for rate limiting
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS failed_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db_connection():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def check_rate_limit(email, max_attempts=5, window_minutes=15):
    """Check if user has exceeded failed login attempts."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cutoff_time = datetime.utcnow() - timedelta(minutes=window_minutes)
    
    cursor.execute('''
        SELECT COUNT(*) as count FROM failed_attempts 
        WHERE email = ? AND attempt_time > ?
    ''', (email, cutoff_time.isoformat()))
    
    result = cursor.fetchone()
    conn.close()
    
    return result['count'] < max_attempts

def record_failed_attempt(email):
    """Record a failed login attempt."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('INSERT INTO failed_attempts (email) VALUES (?)', (email,))
    conn.commit()
    conn.close()

def clear_failed_attempts(email):
    """Clear failed attempts after successful login."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('DELETE FROM failed_attempts WHERE email = ?', (email,))
    conn.commit()
    conn.close()

def generate_token(user_id, email):
    """Generate a JWT token with expiration."""
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24),
        'iat': datetime.utcnow()
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

def verify_token(token):
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def token_required(f):
    """Decorator to require valid JWT token."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Invalid authorization header'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Invalid or expired token'}), 401
        
        request.user_id = payload['user_id']
        request.email = payload['email']
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    """Register a new user."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request body'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        
        # Validate input
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid email format'}), 400
        
        if len(name) < 2 or len(name) > 100:
            return jsonify({'message': 'Name must be between 2 and 100 characters'}), 400
        
        # Hash password
        hashed_password = generate_password_hash(password, method='pbkdf2:sha256')
        
        # Insert into database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO users (email, password, name) 
                VALUES (?, ?, ?)
            ''', (email, hashed_password, name))
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Registration successful'}), 201
        
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use'}), 400
    
    except Exception as e:
        return jsonify({'message': 'An error occurred during registration'}), 500

@app.route('/login', methods=['POST'])
def login():
    """Authenticate a user and return a JWT token."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request body'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        # Validate input
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Check rate limiting
        if not check_rate_limit(email):
            return jsonify({'message': 'Too many failed login attempts. Please try again later'}), 429
        
        # Query user
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, email, password FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        # Verify credentials
        if not user or not check_password_hash(user['password'], password):
            record_failed_attempt(email)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Clear failed attempts on successful login
        clear_failed_attempts(email)
        
        # Generate token
        token = generate_token(user['id'], user['email'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    
    except Exception as e:
        return jsonify({'message': 'An error occurred during login'}), 500

@app.route('/protected', methods=['GET'])
@token_required
def protected():
    """Example protected endpoint."""
    return jsonify({
        'message': 'Access granted',
        'user_id': request.user_id,
        'email': request.email
    }), 200

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)