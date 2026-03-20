import os
import sqlite3
import secrets
import string
from datetime import datetime
from functools import wraps
from flask import Flask, request, jsonify
import jwt
from passlib.context import CryptContext

app = Flask(__name__)

# Security configuration
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key-change-in-production')
app.config['JSON_SORT_KEYS'] = False

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Database initialization
DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database schema"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            created_by_user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used BOOLEAN DEFAULT 0,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        )
    ''')
    
    conn.commit()
    conn.close()

def hash_password(password):
    """Hash a password"""
    return pwd_context.hash(password)

def verify_password(password, password_hash):
    """Verify a password against its hash"""
    return pwd_context.verify(password, password_hash)

def generate_invite_id():
    """Generate a secure random invite ID"""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(32))

def get_current_user():
    """Extract and verify JWT token from request"""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return None
    
    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload.get('user_id')
    except (IndexError, jwt.InvalidTokenError, jwt.ExpiredSignatureError):
        return None

def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = get_current_user()
        if not user_id:
            return jsonify({'message': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated_function

def add_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.after_request
def after_request(response):
    """Apply security headers to all responses"""
    return add_security_headers(response)

@app.route('/invite_user', methods=['POST'])
@require_auth
def invite_user():
    """Create an invitation for a new user"""
    try:
        data = request.get_json()
        if not data or 'email' not in data:
            return jsonify({'message': 'Missing email field'}), 400
        
        email = data.get('email', '').strip()
        
        # Basic email validation
        if not email or '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid email format'}), 400
        
        user_id = get_current_user()
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if invitation already exists for this email
        cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
        existing = cursor.fetchone()
        
        if existing:
            conn.close()
            return jsonify({
                'invite_id': existing['invite_id'],
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Create new invitation
        invite_id = generate_invite_id()
        cursor.execute(
            'INSERT INTO invitations (invite_id, email, created_by_user_id) VALUES (?, ?, ?)',
            (invite_id, email, user_id)
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'invite_id': invite_id,
            'message': f'Invitation created for {email}'
        }), 200
    
    except Exception as e:
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    """Create a new user with a valid invitation"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        invite_id = data.get('invite_id', '').strip()
        username = data.get('user_name', '').strip()
        password = data.get('password', '').strip()
        
        # Validate inputs
        if not invite_id or not username or not password:
            return jsonify({'message': 'Missing required fields'}), 400
        
        if len(username) < 3 or len(username) > 50:
            return jsonify({'message': 'Username must be between 3 and 50 characters'}), 400
        
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters'}), 400
        
        # Validate username contains only alphanumeric and underscore
        if not all(c.isalnum() or c == '_' for c in username):
            return jsonify({'message': 'Username can only contain letters, numbers, and underscores'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Verify invitation exists and is valid
        cursor.execute(
            'SELECT id, email FROM invitations WHERE invite_id = ? AND used = 0',
            (invite_id,)
        )
        invitation = cursor.fetchone()
        
        if not invitation:
            conn.close()
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        email = invitation['email']
        
        # Check if username already exists
        cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Check if email already has a user
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already registered'}), 400
        
        # Create user
        password_hash = hash_password(password)
        cursor.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            (username, password_hash, email)
        )
        
        # Mark invitation as used
        cursor.execute('UPDATE invitations SET used = 1 WHERE id = ?', (invitation['id'],))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'User created successfully'}), 200
    
    except Exception as e:
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/login', methods=['POST'])
def login():
    """Login endpoint to get JWT token"""
    try:
        data = request.get_json()
        if not data or 'username' not in data or 'password' not in data:
            return jsonify({'message': 'Missing credentials'}), 400
        
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, password_hash FROM users WHERE username = ?', (username,))
        user = cursor.fetchone()
        conn.close()
        
        if not user or not verify_password(password, user['password_hash']):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Generate JWT token
        token = jwt.encode(
            {'user_id': user['id']},
            app.config['SECRET_KEY'],
            algorithm='HS256'
        )
        
        return jsonify({'token': token}), 200
    
    except Exception as e:
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok'}), 200

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)