import os
import sqlite3
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt
import jwt

# Get secret from environment variable - must be set before app starts
APP_SECRET = os.environ.get('APP_SECRET')
if not APP_SECRET:
    raise ValueError("APP_SECRET environment variable must be set")

app = Flask(__name__)

# Database configuration
DATABASE = 'db.sqlite3'

# Rate limiting configuration
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_TIME = 300  # 5 minutes in seconds

def get_db():
    """Get database connection"""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    """Close database connection"""
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    """Initialize the database"""
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        
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
        
        # Create login attempts table for rate limiting
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                success INTEGER DEFAULT 0
            )
        ''')
        
        db.commit()

def add_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.after_request
def after_request(response):
    """Add security headers to all responses"""
    return add_security_headers(response)

def check_rate_limit(email):
    """Check if email has exceeded login attempt rate limit"""
    try:
        db = get_db()
        cursor = db.cursor()
        
        # Clean up old attempts
        cutoff_time = datetime.now() - timedelta(seconds=LOCKOUT_TIME)
        cursor.execute(
            'DELETE FROM login_attempts WHERE attempt_time < ?',
            (cutoff_time,)
        )
        db.commit()
        
        # Count recent failed attempts
        cursor.execute(
            '''SELECT COUNT(*) as count FROM login_attempts 
               WHERE email = ? AND success = 0 AND attempt_time > ?''',
            (email, cutoff_time)
        )
        result = cursor.fetchone()
        count = result['count'] if result else 0
        
        return count < MAX_LOGIN_ATTEMPTS
    except Exception:
        # On error, allow the attempt (fail open for availability)
        return True

def record_login_attempt(email, success):
    """Record a login attempt"""
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            'INSERT INTO login_attempts (email, success, attempt_time) VALUES (?, ?, ?)',
            (email, 1 if success else 0, datetime.now())
        )
        db.commit()
    except Exception:
        # Silently fail - don't break login flow
        pass

def create_token(user_id, email):
    """Create JWT token with expiration"""
    try:
        payload = {
            'user_id': user_id,
            'email': email,
            'exp': datetime.utcnow() + timedelta(hours=24),
            'iat': datetime.utcnow()
        }
        token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
        return token
    except Exception:
        return None

def verify_token(token):
    """Verify JWT token"""
    try:
        # Explicitly specify allowed algorithms to prevent 'none' algorithm attack
        payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None

def validate_email(email):
    """Basic email validation"""
    if not email or not isinstance(email, str):
        return False
    if '@' not in email or '.' not in email:
        return False
    if len(email) > 254:
        return False
    return True

def validate_password(password):
    """Basic password validation"""
    if not password or not isinstance(password, str):
        return False
    if len(password) < 6:
        return False
    return True

def validate_name(name):
    """Basic name validation"""
    if not name or not isinstance(name, str):
        return False
    if len(name) < 1 or len(name) > 100:
        return False
    return True

@app.route('/register', methods=['POST'])
def register():
    """User registration endpoint"""
    try:
        # Parse JSON data
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Extract and validate types
        email = data.get('email', '')
        password = data.get('password', '')
        name = data.get('name', '')
        
        # Handle None and non-string types
        if not isinstance(email, str):
            email = ''
        if not isinstance(password, str):
            password = ''
        if not isinstance(name, str):
            name = ''
        
        # Normalize
        email = email.strip().lower()
        name = name.strip()
        
        # Validate input
        if not validate_email(email):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not validate_name(name):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        # Insert into database
        db = get_db()
        cursor = db.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email, password_hash, name)
            )
            db.commit()
        except sqlite3.IntegrityError:
            # Email already exists
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception:
        # Generic error message to avoid information leakage
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    """User login endpoint"""
    try:
        # Parse JSON data
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Extract and validate types
        email = data.get('email', '')
        password = data.get('password', '')
        
        # Handle None and non-string types
        if not isinstance(email, str):
            email = ''
        if not isinstance(password, str):
            password = ''
        
        # Normalize
        email = email.strip().lower()
        
        # Validate input format
        if not validate_email(email) or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Check rate limit
        if not check_rate_limit(email):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Query database
        db = get_db()
        cursor = db.cursor()
        cursor.execute(
            'SELECT id, email, password, name FROM users WHERE email = ?',
            (email,)
        )
        user = cursor.fetchone()
        
        # Verify user and password
        if user and bcrypt.verify(password, user['password']):
            # Successful login
            record_login_attempt(email, True)
            
            # Generate token
            token = create_token(user['id'], user['email'])
            if not token:
                return jsonify({'message': 'Invalid email or password'}), 401
            
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
        else:
            # Failed login
            record_login_attempt(email, False)
            return jsonify({'message': 'Invalid email or password'}), 401
            
    except Exception:
        # Generic error message to avoid information leakage
        return jsonify({'message': 'Invalid email or password'}), 401

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'message': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    """Handle all other exceptions"""
    # Don't leak error details
    return jsonify({'message': 'An error occurred'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the app
    app.run(host='0.0.0.0', port=5000, debug=False)