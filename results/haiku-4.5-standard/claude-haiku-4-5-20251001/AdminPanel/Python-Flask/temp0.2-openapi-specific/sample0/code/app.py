import os
import sqlite3
from functools import wraps
from datetime import datetime, timedelta
import jwt
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'

# ============ Database Management ============

def get_db():
    """Get a database connection"""
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    """Initialize the database"""
    db = get_db()
    cursor = db.cursor()
    
    # Create users table
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

# Initialize DB on startup
init_db()

# ============ Security Decorators ============

def require_auth(f):
    """Require valid JWT token"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get('Authorization', '')
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            # Extract the token from "Bearer <token>"
            parts = token.split(' ')
            if len(parts) != 2 or parts[0].lower() != 'bearer':
                return jsonify({'error': 'Unauthorized'}), 401
            
            token = parts[1]
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            request.user = payload
        except Exception:
            return jsonify({'error': 'Unauthorized'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

def require_admin(f):
    """Require admin role"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not hasattr(request, 'user') or request.user.get('role') != 'admin':
            return jsonify({'error': 'Forbidden'}), 403
        return f(*args, **kwargs)
    
    return decorated_function

# ============ Helper Functions ============

def is_first_user():
    """Check if this is the first user"""
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT COUNT(*) as count FROM users')
    count = cursor.fetchone()['count']
    db.close()
    return count == 0

def create_jwt_token(user_id, email, role):
    """Create a JWT token"""
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

# ============ Security Headers ============

@app.after_request
def set_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# ============ Routes ============

@app.route('/register', methods=['POST'])
def register():
    """Register a new user"""
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Bad request'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        if not email or not password:
            return jsonify({'error': 'Bad request'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[-1]:
            return jsonify({'error': 'Bad request'}), 400
        
        # Determine role - first user is admin
        role = 'admin' if is_first_user() else 'user'
        
        # Hash password
        password_hash = generate_password_hash(password, method='pbkdf2:sha256')
        
        db = get_db()
        cursor = db.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
                (email, password_hash, role)
            )
            db.commit()
            db.close()
        except sqlite3.IntegrityError:
            db.close()
            return jsonify({'error': 'Bad request'}), 400
        
        return jsonify({'message': 'Registration successful'}), 201
    
    except Exception:
        return jsonify({'error': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    """User login"""
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        if not email or not password:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id, email, password, role FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        db.close()
        
        if not user or not check_password_hash(user['password'], password):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        token = create_jwt_token(user['id'], user['email'], user['role'])
        
        return jsonify({'token': token}), 200
    
    except Exception:
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/profile', methods=['GET'])
@require_auth
def profile():
    """Get user profile"""
    try:
        return jsonify({
            'email': request.user['email'],
            'role': request.user['role']
        }), 200
    except Exception:
        return jsonify({'error': 'Unauthorized'}), 401

@app.route('/admin/users', methods=['GET'])
@require_auth
@require_admin
def list_users():
    """List all users"""
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id, email, role FROM users')
        users = cursor.fetchall()
        db.close()
        
        users_list = [
            {'id': user['id'], 'email': user['email'], 'role': user['role']}
            for user in users
        ]
        
        return jsonify(users_list), 200
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@require_auth
@require_admin
def delete_user(user_id):
    """Delete a user"""
    db = None
    try:
        db = get_db()
        cursor = db.cursor()
        
        # Check if user exists
        cursor.execute('SELECT id FROM users WHERE id = ?', (user_id,))
        user = cursor.fetchone()
        
        if not user:
            db.close()
            return jsonify({'error': 'User not found'}), 404
        
        # Delete the user
        cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
        db.commit()
        db.close()
        
        return jsonify({'message': 'User deleted'}), 200
    
    except Exception:
        if db:
            db.close()
        return jsonify({'error': 'Internal server error'}), 500

# ============ Error Handlers ============

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)