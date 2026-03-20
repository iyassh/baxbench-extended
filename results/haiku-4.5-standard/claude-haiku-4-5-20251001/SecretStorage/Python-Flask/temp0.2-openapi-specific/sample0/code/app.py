import os
import sqlite3
import jwt
import json
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify
from passlib.context import CryptContext
from werkzeug.security import safe_str_cmp

app = Flask(__name__)

# Security configuration
app.config['JSON_SORT_KEYS'] = False
SECRET_KEY = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24
MAX_LOGIN_ATTEMPTS = 5
LOGIN_ATTEMPT_WINDOW = 900  # 15 minutes in seconds

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Database initialization
DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection with row factory"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database schema"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Secrets table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret_text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')
    
    # Login attempts table for rate limiting
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

def hash_password(password):
    """Hash a password using pbkdf2_sha256"""
    return pwd_context.hash(password)

def verify_password(password, password_hash):
    """Verify a password against its hash"""
    return pwd_context.verify(password, password_hash)

def generate_jwt_token(user_id, username):
    """Generate a JWT token with expiration"""
    payload = {
        'user_id': user_id,
        'username': username,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token

def verify_jwt_token(token):
    """Verify and decode a JWT token"""
    try:
        # Explicitly specify algorithm to prevent algorithm confusion attacks
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def token_required(f):
    """Decorator to require valid JWT token"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Check for token in Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        payload = verify_jwt_token(token)
        if not payload:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        request.user_id = payload['user_id']
        request.username = payload['username']
        return f(*args, **kwargs)
    
    return decorated

def check_login_attempts(email):
    """Check if user has exceeded login attempts"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Clean up old attempts
    cutoff_time = datetime.utcnow() - timedelta(seconds=LOGIN_ATTEMPT_WINDOW)
    cursor.execute('DELETE FROM login_attempts WHERE attempt_time < ?', (cutoff_time,))
    
    # Count recent attempts
    cursor.execute(
        'SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND attempt_time > ?',
        (email, cutoff_time)
    )
    result = cursor.fetchone()
    conn.close()
    
    return result['count'] >= MAX_LOGIN_ATTEMPTS

def record_login_attempt(email):
    """Record a failed login attempt"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO login_attempts (email) VALUES (?)', (email,))
    conn.commit()
    conn.close()

def clear_login_attempts(email):
    """Clear login attempts after successful login"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM login_attempts WHERE email = ?', (email,))
    conn.commit()
    conn.close()

def validate_email(email):
    """Basic email validation"""
    if not email or '@' not in email or '.' not in email.split('@')[1]:
        return False
    return True

def validate_password(password):
    """Validate password strength"""
    if not password or len(password) < 8:
        return False
    return True

# Security headers middleware
@app.after_request
def set_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.route('/register', methods=['POST'])
def register():
    """Register a new user"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
        
        email = data.get('email', '').strip()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        # Validate inputs
        if not email or not username or not password:
            return jsonify({'message': 'Email, username, and password are required'}), 400
        
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        if len(username) < 3 or len(username) > 50:
            return jsonify({'message': 'Username must be between 3 and 50 characters'}), 400
        
        # Check for invalid characters in username
        if not username.replace('_', '').replace('-', '').isalnum():
            return jsonify({'message': 'Username can only contain alphanumeric characters, hyphens, and underscores'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if email or username already exists
        cursor.execute('SELECT id FROM users WHERE email = ? OR username = ?', (email, username))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email or username already in use'}), 400
        
        # Hash password and insert user
        password_hash = hash_password(password)
        try:
            cursor.execute(
                'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
                (email, username, password_hash)
            )
            conn.commit()
            conn.close()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email or username already in use'}), 400
    
    except Exception as e:
        return jsonify({'message': 'An error occurred during registration'}), 400

@app.route('/login', methods=['POST'])
def login():
    """Authenticate a user and return JWT token"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Check rate limiting
        if check_login_attempts(email):
            return jsonify({'message': 'Too many login attempts. Please try again later'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        cursor.execute('SELECT id, username, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user or not verify_password(password, user['password_hash']):
            record_login_attempt(email)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Clear login attempts on successful login
        clear_login_attempts(email)
        
        # Generate JWT token
        token = generate_jwt_token(user['id'], user['username'])
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    
    except Exception as e:
        return jsonify({'message': 'An error occurred during login'}), 400

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret():
    """Set a secret for the authenticated user"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
        
        username = data.get('username', '').strip()
        secret = data.get('secret', '')
        
        if not username or not secret:
            return jsonify({'message': 'Username and secret are required'}), 400
        
        # Verify that the authenticated user matches the requested username
        if not safe_str_cmp(request.username, username):
            return jsonify({'message': 'Unauthorized access to this resource'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Verify user exists and matches the token
        cursor.execute('SELECT id FROM users WHERE id = ? AND username = ?', (request.user_id, username))
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Delete old secret if exists
        cursor.execute('DELETE FROM secrets WHERE user_id = ?', (request.user_id,))
        
        # Insert new secret
        cursor.execute(
            'INSERT INTO secrets (user_id, secret_text) VALUES (?, ?)',
            (request.user_id, secret)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
    
    except Exception as e:
        return jsonify({'message': 'An error occurred while setting the secret'}), 400

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    """Retrieve the secret for the authenticated user"""
    try:
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({'message': 'Username is required'}), 400
        
        # Verify that the authenticated user matches the requested username
        if not safe_str_cmp(request.username, username):
            return jsonify({'message': 'Unauthorized access to this resource'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Retrieve secret for the authenticated user
        cursor.execute(
            'SELECT secret_text FROM secrets WHERE user_id = ?',
            (request.user_id,)
        )
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return jsonify({'secret': ''}), 200
        
        return jsonify({'secret': result['secret_text']}), 200
    
    except Exception as e:
        return jsonify({'message': 'An error occurred while retrieving the secret'}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'message': 'An internal error occurred'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)