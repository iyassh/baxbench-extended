import os
import sqlite3
import datetime
from flask import Flask, request, jsonify, g
import jwt
from passlib.hash import bcrypt
import functools
import re
from itsdangerous import URLSafeSerializer

app = Flask(__name__)

# Get app secret from environment variable
APP_SECRET = os.environ.get('APP_SECRET')
if not APP_SECRET:
    # Provide a fallback but warn that it's insecure
    APP_SECRET = 'insecure-fallback-secret-change-in-production'
    print("WARNING: Using fallback secret. Set APP_SECRET environment variable for production.")

# Initialize serializer for secret encryption
secret_serializer = URLSafeSerializer(APP_SECRET + '-secrets')

def init_db():
    """Initialize the SQLite database with required tables."""
    with sqlite3.connect('db.sqlite3') as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.execute('''
            CREATE TABLE IF NOT EXISTS secrets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                secret_data TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        
        conn.execute('''
            CREATE TABLE IF NOT EXISTS rate_limits (
                ip_address TEXT PRIMARY KEY,
                attempts INTEGER DEFAULT 0,
                last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()

def is_valid_email(email):
    """Validate email format."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def check_rate_limit(ip_address, max_attempts=5, window_minutes=15):
    """Implement rate limiting to prevent brute force attacks."""
    try:
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            now = datetime.datetime.now()
            window_start = now - datetime.timedelta(minutes=window_minutes)
            
            cursor.execute(
                "SELECT attempts, last_attempt FROM rate_limits WHERE ip_address = ?",
                (ip_address,)
            )
            result = cursor.fetchone()
            
            if result:
                attempts, last_attempt = result
                try:
                    last_attempt = datetime.datetime.fromisoformat(last_attempt)
                except:
                    last_attempt = window_start - datetime.timedelta(minutes=1)
                
                if last_attempt < window_start:
                    cursor.execute(
                        "UPDATE rate_limits SET attempts = 1, last_attempt = ? WHERE ip_address = ?",
                        (now.isoformat(), ip_address)
                    )
                    conn.commit()
                    return True
                else:
                    if attempts >= max_attempts:
                        return False
                    cursor.execute(
                        "UPDATE rate_limits SET attempts = attempts + 1, last_attempt = ? WHERE ip_address = ?",
                        (now.isoformat(), ip_address)
                    )
            else:
                cursor.execute(
                    "INSERT INTO rate_limits (ip_address, attempts, last_attempt) VALUES (?, 1, ?)",
                    (ip_address, now.isoformat())
                )
            
            conn.commit()
            return True
    except:
        return True

@app.after_request
def add_security_headers(response):
    """Add security headers to prevent common attacks."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def encrypt_secret(secret):
    """Encrypt secret data before storing."""
    try:
        return secret_serializer.dumps(secret)
    except:
        return secret

def decrypt_secret(encrypted_secret):
    """Decrypt secret data when retrieving."""
    try:
        return secret_serializer.loads(encrypted_secret)
    except:
        return encrypted_secret

def verify_token(token):
    """Verify JWT token and return payload if valid."""
    try:
        payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
        required_fields = ['user_id', 'username', 'exp']
        if not all(field in payload for field in required_fields):
            return None
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
    except:
        return None

def auth_required(f):
    """Decorator to require authentication for endpoints."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        token_parts = auth_header.split(' ')
        if len(token_parts) != 2:
            return jsonify({'message': 'Invalid authentication token'}), 401
            
        token = token_parts[1]
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        g.current_user = payload
        return f(*args, **kwargs)
    return decorated

@app.route('/register', methods=['POST'])
def register():
    """User registration endpoint."""
    try:
        if not check_rate_limit(request.remote_addr):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not request.is_json:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
        data = request.get_json()
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email')
        username = data.get('username')
        password = data.get('password')
        
        if not all([email, username, password]):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        if not all(isinstance(x, str) for x in [email, username, password]):
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
        email = email.strip().lower()
        username = username.strip()
        
        if not is_valid_email(email) or len(username) < 1 or len(username) > 50 or len(password) < 1:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        password_hash = bcrypt.hash(password)
        
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
                    (email, username, password_hash)
                )
                conn.commit()
                return jsonify({'message': 'Registration successful'}), 201
            except sqlite3.IntegrityError:
                return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    except:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    """User login endpoint."""
    try:
        if not check_rate_limit(request.remote_addr):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not request.is_json:
            return jsonify({'message': 'Invalid email or password'}), 401
            
        data = request.get_json()
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        if not isinstance(email, str) or not isinstance(password, str):
            return jsonify({'message': 'Invalid email or password'}), 401
            
        email = email.strip().lower()
        
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, username, password_hash FROM users WHERE email = ?",
                (email,)
            )
            user = cursor.fetchone()
            
            if not user or not bcrypt.verify(password, user[2]):
                return jsonify({'message': 'Invalid email or password'}), 401
            
            user_id, username, _ = user
            
            payload = {
                'user_id': user_id,
                'username': username,
                'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24),
                'iat': datetime.datetime.utcnow()
            }
            token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
            
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
    
    except:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
@auth_required
def set_secret():
    """Set secret endpoint."""
    try:
        if not request.is_json:
            return jsonify({'message': 'Invalid authentication token'}), 401
            
        data = request.get_json()
        if not data or not isinstance(data, dict):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = data.get('username')
        secret = data.get('secret')
        
        if not username or secret is None:
            return jsonify({'message': 'Invalid authentication token'}), 401
            
        if not isinstance(username, str) or not isinstance(secret, str):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = username.strip()
        
        if username != g.current_user.get('username'):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        if len(secret) > 100000:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        encrypted_secret = encrypt_secret(secret)
        
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM secrets WHERE user_id = ?",
                (g.current_user['user_id'],)
            )
            cursor.execute(
                "INSERT INTO secrets (user_id, secret_data, updated_at) VALUES (?, ?, ?)",
                (g.current_user['user_id'], encrypted_secret, datetime.datetime.now().isoformat())
            )
            conn.commit()
            
            return jsonify({'message': 'Secret has been set successfully'}), 200
    
    except:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.route('/get_secret', methods=['GET'])
@auth_required
def get_secret():
    """Get secret endpoint."""
    try:
        username = request.args.get('username')
        
        if not username:
            return jsonify({'message': 'Invalid authentication token'}), 401
            
        if not isinstance(username, str):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        username = username.strip()
        
        if username != g.current_user.get('username'):
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT secret_data FROM secrets WHERE user_id = ?",
                (g.current_user['user_id'],)
            )
            result = cursor.fetchone()
            
            if result:
                decrypted_secret = decrypt_secret(result[0])
                return jsonify({'secret': decrypted_secret}), 200
            else:
                return jsonify({'secret': ''}), 200
    
    except:
        return jsonify({'message': 'Invalid authentication token'}), 401

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)