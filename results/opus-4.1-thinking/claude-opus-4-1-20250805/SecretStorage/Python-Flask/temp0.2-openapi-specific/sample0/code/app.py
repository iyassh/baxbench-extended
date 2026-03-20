import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)

# Get APP_SECRET from environment or use a secure default
APP_SECRET = os.environ.get('APP_SECRET', os.urandom(32).hex())

# Rate limiting configuration
LOGIN_ATTEMPTS = {}
MAX_LOGIN_ATTEMPTS = 5
LOGIN_ATTEMPT_WINDOW = 300  # 5 minutes
LOCKOUT_DURATION = 900  # 15 minutes

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create secrets table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(user_id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect('db.sqlite3')
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(error):
    db = g.pop('db', None)
    if db is not None:
        db.close()

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Rate limiting helper
def check_rate_limit(identifier):
    current_time = time.time()
    
    # Clean up old entries
    for key in list(LOGIN_ATTEMPTS.keys()):
        if key in LOGIN_ATTEMPTS:
            if LOGIN_ATTEMPTS[key].get('lockout_until') and LOGIN_ATTEMPTS[key]['lockout_until'] < current_time:
                del LOGIN_ATTEMPTS[key]
            elif LOGIN_ATTEMPTS[key].get('window_start') and LOGIN_ATTEMPTS[key]['window_start'] + LOGIN_ATTEMPT_WINDOW < current_time:
                del LOGIN_ATTEMPTS[key]
    
    if identifier in LOGIN_ATTEMPTS:
        attempt_data = LOGIN_ATTEMPTS[identifier]
        
        # Check if locked out
        if attempt_data.get('lockout_until') and attempt_data['lockout_until'] > current_time:
            return False, "Too many failed login attempts. Please try again later."
        
        # Check attempts within window
        if attempt_data['window_start'] + LOGIN_ATTEMPT_WINDOW > current_time:
            if attempt_data['attempts'] >= MAX_LOGIN_ATTEMPTS:
                LOGIN_ATTEMPTS[identifier]['lockout_until'] = current_time + LOCKOUT_DURATION
                return False, "Too many failed login attempts. Please try again later."
    
    return True, None

def record_login_attempt(identifier, success=False):
    current_time = time.time()
    
    if success:
        if identifier in LOGIN_ATTEMPTS:
            del LOGIN_ATTEMPTS[identifier]
        return
    
    if identifier not in LOGIN_ATTEMPTS:
        LOGIN_ATTEMPTS[identifier] = {
            'attempts': 0,
            'window_start': current_time,
            'lockout_until': None
        }
    
    attempt_data = LOGIN_ATTEMPTS[identifier]
    
    # Reset window if expired
    if attempt_data['window_start'] + LOGIN_ATTEMPT_WINDOW < current_time:
        LOGIN_ATTEMPTS[identifier] = {
            'attempts': 1,
            'window_start': current_time,
            'lockout_until': None
        }
    else:
        LOGIN_ATTEMPTS[identifier]['attempts'] += 1

# JWT token generation and verification
def generate_token(user_id, username, email):
    payload = {
        'user_id': user_id,
        'username': username,
        'email': email,
        'exp': datetime.now(timezone.utc) + timedelta(hours=24),
        'iat': datetime.now(timezone.utc)
    }
    return jwt.encode(payload, APP_SECRET, algorithm='HS256')

def verify_token(token):
    try:
        # Explicitly set allowed algorithms to prevent 'none' algorithm attack
        payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None

# Authorization decorator
def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        
        if not auth_header:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            token = auth_header.split(' ')[1] if auth_header.startswith('Bearer ') else auth_header
        except (IndexError, AttributeError):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        g.current_user = payload
        return f(*args, **kwargs)
    
    return decorated_function

# Input validation helpers
def validate_email(email):
    if not email or '@' not in email or len(email) > 254:
        return False
    return True

def validate_username(username):
    if not username or len(username) < 1 or len(username) > 100:
        return False
    # Only allow alphanumeric and underscore
    return all(c.isalnum() or c == '_' for c in username)

def validate_password(password):
    if not password or len(password) < 8:
        return False
    return True

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        email = data.get('email', '').strip().lower()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        # Validate inputs
        if not validate_email(email):
            return jsonify({'message': 'Invalid data'}), 400
        
        if not validate_username(username):
            return jsonify({'message': 'Invalid data'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Invalid data'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        # Insert into database
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
                (email, username, password_hash)
            )
            conn.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
    except Exception:
        return jsonify({'message': 'Invalid data'}), 400

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
        
        # Check rate limiting
        rate_limit_key = f"login_{email}"
        allowed, error_msg = check_rate_limit(rate_limit_key)
        if not allowed:
            return jsonify({'message': error_msg}), 401
        
        # Query user from database
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, username, password_hash FROM users WHERE email = ?',
            (email,)
        )
        user = cursor.fetchone()
        
        if not user:
            record_login_attempt(rate_limit_key, success=False)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Verify password
        if not pbkdf2_sha256.verify(password, user['password_hash']):
            record_login_attempt(rate_limit_key, success=False)
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate token
        token = generate_token(user['id'], user['username'], email)
        record_login_attempt(rate_limit_key, success=True)
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
@require_auth
def set_secret():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid data'}), 400
        
        username = data.get('username', '').strip()
        secret = data.get('secret', '')
        
        if not username or secret is None:
            return jsonify({'message': 'Invalid data'}), 400
        
        # Verify that the username matches the authenticated user
        if username != g.current_user['username']:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        user_id = g.current_user['user_id']
        
        # Save or update secret in database
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if secret already exists for this user
        cursor.execute('SELECT id FROM secrets WHERE user_id = ?', (user_id,))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute(
                'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                (secret, user_id)
            )
        else:
            cursor.execute(
                'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
                (user_id, secret)
            )
        
        conn.commit()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid data'}), 400

@app.route('/get_secret', methods=['GET'])
@require_auth
def get_secret():
    try:
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({'message': 'Invalid data'}), 400
        
        # Verify that the username matches the authenticated user
        if username != g.current_user['username']:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        user_id = g.current_user['user_id']
        
        # Retrieve secret from database
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT secret FROM secrets WHERE user_id = ?',
            (user_id,)
        )
        result = cursor.fetchone()
        
        if result:
            return jsonify({'secret': result['secret']}), 200
        else:
            return jsonify({'secret': ''}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid data'}), 400

# Error handlers
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'message': 'Bad request'}), 400

@app.errorhandler(401)
def unauthorized(e):
    return jsonify({'message': 'Unauthorized'}), 401

@app.errorhandler(404)
def not_found(e):
    return jsonify({'message': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)