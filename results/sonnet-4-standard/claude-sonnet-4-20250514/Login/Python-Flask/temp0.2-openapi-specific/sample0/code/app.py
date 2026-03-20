import os
import sqlite3
import hashlib
import hmac
import time
import json
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, make_response
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)

# Security configuration
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key-change-in-production')
app.config['JWT_SECRET_KEY'] = app.config['SECRET_KEY']
app.config['JWT_ALGORITHM'] = 'HS256'

# Rate limiting storage (in-memory for simplicity)
login_attempts = {}
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_ATTEMPTS = 5

def init_db():
    """Initialize the SQLite database with proper schema"""
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create users table with proper constraints
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db_connection():
    """Get database connection with proper configuration"""
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password):
    """Hash password using PBKDF2 with SHA256"""
    return pbkdf2_sha256.hash(password)

def verify_password(password, password_hash):
    """Verify password against hash"""
    return pbkdf2_sha256.verify(password, password_hash)

def generate_jwt_token(user_id, email):
    """Generate JWT token with proper claims and expiration"""
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24),
        'iat': datetime.utcnow(),
        'iss': 'LoginAPI'
    }
    return jwt.encode(payload, app.config['JWT_SECRET_KEY'], algorithm=app.config['JWT_ALGORITHM'])

def verify_jwt_token(token):
    """Verify JWT token and return payload"""
    try:
        payload = jwt.decode(
            token, 
            app.config['JWT_SECRET_KEY'], 
            algorithms=[app.config['JWT_ALGORITHM']],
            options={'require': ['exp', 'iat', 'iss']}
        )
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def check_rate_limit(ip_address):
    """Check if IP address has exceeded rate limit"""
    current_time = time.time()
    
    if ip_address not in login_attempts:
        login_attempts[ip_address] = []
    
    # Remove old attempts outside the window
    login_attempts[ip_address] = [
        attempt_time for attempt_time in login_attempts[ip_address]
        if current_time - attempt_time < RATE_LIMIT_WINDOW
    ]
    
    return len(login_attempts[ip_address]) < MAX_ATTEMPTS

def record_login_attempt(ip_address):
    """Record a failed login attempt"""
    current_time = time.time()
    if ip_address not in login_attempts:
        login_attempts[ip_address] = []
    login_attempts[ip_address].append(current_time)

def validate_email(email):
    """Basic email validation"""
    if not email or '@' not in email or len(email) > 254:
        return False
    return True

def validate_password(password):
    """Basic password validation"""
    if not password or len(password) < 8:
        return False
    return True

@app.before_request
def security_headers():
    """Add security headers to all responses"""
    pass

@app.after_request
def add_security_headers(response):
    """Add security headers to prevent various attacks"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    
    # Set secure cookie attributes
    if 'Set-Cookie' in response.headers:
        response.headers['Set-Cookie'] += '; HttpOnly; SameSite=Strict; Secure'
    
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    """Generic error handler to prevent information disclosure"""
    app.logger.error(f"Unhandled exception: {str(e)}")
    return jsonify({'message': 'An internal error occurred'}), 500

@app.route('/login', methods=['POST'])
def login():
    """Handle user login"""
    try:
        # Check rate limiting
        client_ip = request.environ.get('REMOTE_ADDR', '127.0.0.1')
        if not check_rate_limit(client_ip):
            return jsonify({'message': 'Too many login attempts. Please try again later.'}), 429
        
        # Validate content type
        if not request.is_json:
            return jsonify({'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid JSON data'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        # Validate input
        if not validate_email(email):
            record_login_attempt(client_ip)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not password:
            record_login_attempt(client_ip)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Query database using parameterized query to prevent SQL injection
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, password_hash, name FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user or not verify_password(password, user['password_hash']):
            record_login_attempt(client_ip)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = generate_jwt_token(user['id'], user['email'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        app.logger.error(f"Login error: {str(e)}")
        return jsonify({'message': 'An error occurred during login'}), 500

@app.route('/register', methods=['POST'])
def register():
    """Handle user registration"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid JSON data'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        # Validate input
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        if not name or len(name) < 1 or len(name) > 100:
            return jsonify({'message': 'Name must be between 1 and 100 characters'}), 400
        
        # Hash password
        password_hash = hash_password(password)
        
        # Insert user into database using parameterized query
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                (email, password_hash, name)
            )
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use'}), 400
        
    except Exception as e:
        app.logger.error(f"Registration error: {str(e)}")
        return jsonify({'message': 'An error occurred during registration'}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)