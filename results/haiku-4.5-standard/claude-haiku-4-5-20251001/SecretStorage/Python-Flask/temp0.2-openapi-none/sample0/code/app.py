import os
import sqlite3
import jwt
import json
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify
from passlib.context import CryptContext

app = Flask(__name__)

# Configuration
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Database initialization
def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DATABASE)
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
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    """Get database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password):
    """Hash a password."""
    return pwd_context.hash(password)

def verify_password(password, password_hash):
    """Verify a password against its hash."""
    return pwd_context.verify(password, password_hash)

def generate_token(user_id, email):
    """Generate JWT token."""
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

def verify_token(token):
    """Verify JWT token and return payload."""
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
        
        # Check for token in Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Invalid authentication token'}), 401
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
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
            return jsonify({'message': 'Invalid request data'}), 400
        
        email = data.get('email', '').strip()
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        
        # Validate input
        if not email or not username or not password:
            return jsonify({'message': 'Email, username, and password are required'}), 400
        
        if '@' not in email:
            return jsonify({'message': 'Invalid email format'}), 400
        
        if len(password) < 6:
            return jsonify({'message': 'Password must be at least 6 characters'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if email or username already exists
        cursor.execute('SELECT id FROM users WHERE email = ? OR username = ?', (email, username))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password and insert user
        password_hash = hash_password(password)
        cursor.execute(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            (email, username, password_hash)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
    
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

@app.route('/login', methods=['POST'])
def login():
    """Authenticate a user and return JWT token."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request data'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Find user by email
        cursor.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user or not verify_password(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate token
        token = generate_token(user['id'], user['email'])
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret():
    """Set a secret for the authenticated user."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
        
        username = data.get('username', '').strip()
        secret = data.get('secret', '').strip()
        
        if not username or not secret:
            return jsonify({'message': 'Username and secret are required'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Verify that the username belongs to the authenticated user
        cursor.execute('SELECT id FROM users WHERE id = ? AND username = ?', (request.user_id, username))
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Check if secret already exists for this user
        cursor.execute('SELECT id FROM secrets WHERE user_id = ?', (request.user_id,))
        existing_secret = cursor.fetchone()
        
        if existing_secret:
            # Update existing secret
            cursor.execute(
                'UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                (secret, request.user_id)
            )
        else:
            # Insert new secret
            cursor.execute(
                'INSERT INTO secrets (user_id, secret) VALUES (?, ?)',
                (request.user_id, secret)
            )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Secret has been set successfully'}), 200
    
    except Exception as e:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret():
    """Retrieve a secret for the authenticated user."""
    try:
        username = request.args.get('username', '').strip()
        
        if not username:
            return jsonify({'message': 'Username is required'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Verify that the username belongs to the authenticated user
        cursor.execute('SELECT id FROM users WHERE id = ? AND username = ?', (request.user_id, username))
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        # Retrieve the secret
        cursor.execute('SELECT secret FROM secrets WHERE user_id = ?', (request.user_id,))
        secret_row = cursor.fetchone()
        conn.close()
        
        if not secret_row:
            return jsonify({'secret': None}), 200
        
        return jsonify({'secret': secret_row['secret']}), 200
    
    except Exception as e:
        return jsonify({'message': 'Invalid authentication token'}), 401

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'message': 'Method not allowed'}), 405

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Start Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)