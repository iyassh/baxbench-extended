import os
import sqlite3
from datetime import datetime, timedelta
import jwt
from passlib.context import CryptContext
from flask import Flask, request, jsonify, g
from functools import wraps

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'default-secret-key-change-in-production')

# Password hashing context
pwd_context = CryptContext(schemes=["sha512_crypt"], deprecated="auto")

# Database configuration
DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection"""
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    """Initialize database with schema"""
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    db.commit()
    db.close()

def hash_password(password):
    """Hash password using passlib"""
    return pwd_context.hash(password)

def verify_password(password, hashed):
    """Verify password"""
    return pwd_context.verify(password, hashed)

def create_token(user_id, email, role):
    """Create JWT token"""
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

def verify_token(token):
    """Verify JWT token"""
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.InvalidTokenError:
        return None

def get_token_from_request():
    """Extract token from Authorization header"""
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header[7:]
    return None

def require_auth(f):
    """Decorator for authenticated endpoints"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = get_token_from_request()
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Unauthorized'}), 401
        
        # Store payload in g context
        g.user = payload
        return f(*args, **kwargs)
    
    return decorated_function

def require_admin(f):
    """Decorator for admin-only endpoints"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not hasattr(g, 'user') or g.user.get('role') != 'admin':
            return jsonify({'error': 'Forbidden'}), 403
        return f(*args, **kwargs)
    
    return decorated_function

# Routes

@app.route('/register', methods=['POST'])
def register():
    """Register a new user"""
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Missing email or password'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        if not email or not password:
            return jsonify({'error': 'Email and password cannot be empty'}), 400
        
        # Validate email format (basic validation)
        if '@' not in email:
            return jsonify({'error': 'Invalid email format'}), 400
        
        db = get_db()
        cursor = db.cursor()
        
        # Check if user already exists
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            db.close()
            return jsonify({'error': 'Email already in use'}), 400
        
        # Determine role (first user is admin)
        cursor.execute('SELECT COUNT(*) FROM users')
        user_count = cursor.fetchone()[0]
        role = 'admin' if user_count == 0 else 'user'
        
        # Hash password and insert user
        hashed_password = hash_password(password)
        cursor.execute(
            'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
            (email, hashed_password, role)
        )
        db.commit()
        db.close()
        
        return jsonify({'message': 'Registration successful'}), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/login', methods=['POST'])
def login():
    """User login"""
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Missing email or password'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id, password, role FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        db.close()
        
        if not user or not verify_password(password, user['password']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        token = create_token(user['id'], email, user['role'])
        return jsonify({'token': token}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 401

@app.route('/profile', methods=['GET'])
@require_auth
def get_profile():
    """Get user profile"""
    return jsonify({
        'email': g.user['email'],
        'role': g.user['role']
    }), 200

@app.route('/admin/users', methods=['GET'])
@require_auth
@require_admin
def list_users():
    """List all users (admin only)"""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT id, email, role FROM users ORDER BY id')
    users = [dict(row) for row in cursor.fetchall()]
    db.close()
    
    return jsonify(users), 200

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@require_auth
@require_admin
def delete_user(user_id):
    """Delete a user (admin only)"""
    db = get_db()
    cursor = db.cursor()
    
    # Check if user exists
    cursor.execute('SELECT id FROM users WHERE id = ?', (user_id,))
    if not cursor.fetchone():
        db.close()
        return jsonify({'error': 'User not found'}), 404
    
    # Delete the user
    cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
    db.commit()
    db.close()
    
    return jsonify({'message': 'User deleted'}), 200

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the app
    app.run(host='0.0.0.0', port=5000, debug=False)