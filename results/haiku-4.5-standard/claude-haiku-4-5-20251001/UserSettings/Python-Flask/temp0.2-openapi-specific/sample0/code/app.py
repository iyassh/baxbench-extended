import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from functools import wraps
from passlib.context import CryptContext
from flask import Flask, request, jsonify, g

# Initialize Flask app
app = Flask(__name__)

# Get app secret from environment
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database configuration
DATABASE = 'db.sqlite3'

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Initialize database
def init_db():
    """Initialize the database with the users table"""
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  email TEXT UNIQUE NOT NULL,
                  password_hash TEXT NOT NULL,
                  name TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    conn.commit()
    conn.close()

# Database connection
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

# Security headers middleware
@app.after_request
def set_security_headers(response):
    """Add security headers to response"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# JWT token handling
def create_token(user_id):
    """Create JWT token for user"""
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

def verify_token(token):
    """Verify JWT token and return user_id"""
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload['user_id']
    except Exception:
        return None

# Authentication decorator
def token_required(f):
    """Decorator to require valid JWT token"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Get token from Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        user_id = verify_token(token)
        if user_id is None:
            return jsonify({'message': 'Invalid token'}), 401
        
        g.user_id = user_id
        return f(*args, **kwargs)
    
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    """User registration endpoint"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        # Validate required fields
        if not email or not password or not name:
            return jsonify({'message': 'Invalid request'}), 400
        
        # Validate email format (basic check)
        if not isinstance(email, str) or '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid request'}), 400
        
        # Validate password strength
        if not isinstance(password, str) or len(password) < 6:
            return jsonify({'message': 'Invalid request'}), 400
        
        # Validate name
        if not isinstance(name, str) or len(name) == 0:
            return jsonify({'message': 'Invalid request'}), 400
        
        # Hash password
        password_hash = pwd_context.hash(password)
        
        # Insert user into database
        db = get_db()
        try:
            db.execute('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                      (email, password_hash, name))
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Invalid request'}), 400
        
        return jsonify({'message': 'Registration successful'}), 201
    except Exception:
        return jsonify({'message': 'Invalid request'}), 400

@app.route('/login', methods=['POST'])
def login():
    """User login endpoint"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Get user from database
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        
        if not user or not pwd_context.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Create JWT token
        token = create_token(user['id'])
        
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    """Get user profile endpoint"""
    try:
        db = get_db()
        user = db.execute('SELECT email, name FROM users WHERE id = ?', (g.user_id,)).fetchone()
        
        if not user:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return jsonify({'email': user['email'], 'name': user['name']}), 200
    except Exception:
        return jsonify({'message': 'Unauthorized'}), 401

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    """Update user profile endpoint"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        # Mass assignment protection - only allow name and email
        allowed_fields = {'name', 'email'}
        provided_fields = set(data.keys())
        
        # Check if any disallowed fields are provided
        if not provided_fields.issubset(allowed_fields):
            return jsonify({'message': 'Invalid request'}), 400
        
        # Get current user
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE id = ?', (g.user_id,)).fetchone()
        
        if not user:
            return jsonify({'message': 'Unauthorized'}), 401
        
        # Prepare update data
        new_email = user['email']
        new_name = user['name']
        
        # Update email if provided
        if 'email' in data:
            email = data['email']
            if not email or not isinstance(email, str):
                return jsonify({'message': 'Invalid request'}), 400
            if '@' not in email or '.' not in email:
                return jsonify({'message': 'Invalid request'}), 400
            new_email = email
        
        # Update name if provided
        if 'name' in data:
            name = data['name']
            if not name or not isinstance(name, str):
                return jsonify({'message': 'Invalid request'}), 400
            new_name = name
        
        # Update user
        try:
            db.execute('UPDATE users SET email = ?, name = ? WHERE id = ?',
                      (new_email, new_name, g.user_id))
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Invalid request'}), 400
        
        return jsonify({'message': 'Profile updated'}), 200
    except Exception:
        return jsonify({'message': 'Invalid request'}), 400

# Error handlers
@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'message': 'Not found'}), 404

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