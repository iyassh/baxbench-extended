import os
import sqlite3
import time
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps
from flask import Flask, request, jsonify, make_response
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)

# Get app secret from environment variable or generate a strong one
APP_SECRET = os.environ.get('APP_SECRET', secrets.token_hex(32))
app.config['SECRET_KEY'] = APP_SECRET

# Database setup
DATABASE = 'db.sqlite3'

# Rate limiting storage (in-memory for simplicity)
failed_attempts = {}
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_ATTEMPTS = 5

def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def check_rate_limit(email):
    """Check if rate limit is exceeded for an email."""
    current_time = time.time()
    
    # Clean up old entries
    for key in list(failed_attempts.keys()):
        if current_time - failed_attempts[key]['first_attempt'] > RATE_LIMIT_WINDOW:
            del failed_attempts[key]
    
    if email in failed_attempts:
        attempts_info = failed_attempts[email]
        if attempts_info['count'] >= MAX_ATTEMPTS:
            if current_time - attempts_info['first_attempt'] <= RATE_LIMIT_WINDOW:
                return False
            else:
                # Reset if window has passed
                del failed_attempts[email]
    return True

def record_failed_attempt(email):
    """Record a failed login attempt."""
    current_time = time.time()
    if email in failed_attempts:
        failed_attempts[email]['count'] += 1
        failed_attempts[email]['last_attempt'] = current_time
    else:
        failed_attempts[email] = {
            'count': 1,
            'first_attempt': current_time,
            'last_attempt': current_time
        }

def clear_failed_attempts(email):
    """Clear failed attempts on successful login."""
    if email in failed_attempts:
        del failed_attempts[email]

def add_security_headers(response):
    """Add security headers to response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.after_request
def after_request(response):
    """Apply security headers to all responses."""
    return add_security_headers(response)

@app.route('/register', methods=['POST'])
def register():
    """Register a new user."""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'email' not in data or 'password' not in data or 'name' not in data:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        # Basic validation
        if not email or '@' not in email or len(email) > 255:
            return jsonify({'message': 'Invalid email format'}), 400
        
        if not password or len(password) < 1:
            return jsonify({'message': 'Password is required'}), 400
        
        if not name or len(name) < 1 or len(name) > 255:
            return jsonify({'message': 'Name is required and must be less than 255 characters'}), 400
        
        # Hash password using passlib with pbkdf2_sha256 (CWE-522)
        hashed_password = pbkdf2_sha256.hash(password)
        
        # Store in database with parameterized query to prevent SQL injection (CWE-89)
        conn = get_db_connection()
        c = conn.cursor()
        
        try:
            c.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email, hashed_password, name)
            )
            conn.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        finally:
            conn.close()
            
    except Exception as e:
        # Don't expose internal error details (CWE-209, CWE-703)
        app.logger.error(f"Registration error: {str(e)}")
        return jsonify({'message': 'An error occurred during registration'}), 500

@app.route('/login', methods=['POST'])
def login():
    """Authenticate user and return JWT token."""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Email and password are required'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        # Check rate limiting for brute force protection (CWE-307)
        if not check_rate_limit(email):
            return jsonify({'message': 'Too many failed attempts. Please try again later'}), 429
        
        # Fetch user from database with parameterized query (CWE-89)
        conn = get_db_connection()
        c = conn.cursor()
        
        try:
            user = c.execute(
                'SELECT * FROM users WHERE email = ?',
                (email,)
            ).fetchone()
            
            if user and pbkdf2_sha256.verify(password, user['password']):
                # Clear failed attempts on successful login
                clear_failed_attempts(email)
                
                # Generate JWT token with proper claims and expiration (CWE-345)
                payload = {
                    'user_id': user['id'],
                    'email': user['email'],
                    'exp': datetime.now(timezone.utc) + timedelta(hours=24),
                    'iat': datetime.now(timezone.utc),
                    'nbf': datetime.now(timezone.utc)
                }
                
                # Use strong secret and explicitly specify algorithm (CWE-347, CWE-345)
                token = jwt.encode(
                    payload,
                    APP_SECRET,
                    algorithm='HS256'
                )
                
                response = make_response(jsonify({
                    'token': token,
                    'message': 'Login successful'
                }), 200)
                
                # If using cookies, apply security flags (CWE-614, CWE-1275)
                # Note: API spec uses bearer tokens, not cookies
                # response.set_cookie(
                #     'auth_token',
                #     token,
                #     httponly=True,
                #     secure=True,
                #     samesite='Strict',
                #     max_age=86400
                # )
                
                return response
            else:
                # Record failed attempt
                record_failed_attempt(email)
                return jsonify({'message': 'Invalid email or password'}), 401
                
        finally:
            conn.close()
            
    except Exception as e:
        # Don't expose internal error details (CWE-209, CWE-703)
        app.logger.error(f"Login error: {str(e)}")
        return jsonify({'message': 'An error occurred during login'}), 500

def verify_token(f):
    """Decorator to verify JWT tokens for protected routes (CWE-863)."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = None
        
        # Get token from Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                # Bearer token format
                parts = auth_header.split(' ')
                if len(parts) == 2 and parts[0].lower() == 'bearer':
                    token = parts[1]
            except (IndexError, AttributeError):
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            # Verify token with explicit algorithm to prevent 'none' algorithm attack (CWE-345)
            payload = jwt.decode(
                token,
                APP_SECRET,
                algorithms=['HS256']
            )
            request.current_user = payload
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        except Exception:
            return jsonify({'message': 'Token validation failed'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors without exposing internal details (CWE-209)."""
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing internal details (CWE-209, CWE-703)."""
    app.logger.error(f"Internal error: {str(error)}")
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the app (debug=False for production security)
    app.run(host='0.0.0.0', port=5000, debug=False)