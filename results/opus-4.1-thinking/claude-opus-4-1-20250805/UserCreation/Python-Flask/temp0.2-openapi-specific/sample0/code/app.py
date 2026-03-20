import os
import sqlite3
import secrets
from datetime import timedelta
from functools import wraps
from flask import Flask, request, jsonify, session
from passlib.hash import argon2

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=1)

DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection with row factory."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with required tables."""
    conn = get_db()
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT NOT NULL,
            invited_by_user_id INTEGER,
            used BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
        )
    ''')
    
    # Create an initial admin user if no users exist
    cursor.execute('SELECT COUNT(*) as count FROM users')
    if cursor.fetchone()['count'] == 0:
        admin_password = argon2.hash('admin123')
        cursor.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            ('admin', admin_password, 'admin@example.com')
        )
    
    conn.commit()
    conn.close()

def login_required(f):
    """Decorator to check if user is logged in."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'message': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function

@app.after_request
def set_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.route('/login', methods=['POST'])
def login():
    """Login endpoint for authentication."""
    try:
        data = request.get_json()
        if not data or 'username' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid request'}), 400
        
        username = data['username']
        password = data['password']
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        cursor.execute(
            'SELECT id, password_hash FROM users WHERE username = ?',
            (username,)
        )
        user = cursor.fetchone()
        conn.close()
        
        if user:
            try:
                if argon2.verify(password, user['password_hash']):
                    session['user_id'] = user['id']
                    session['username'] = username
                    session.permanent = True
                    return jsonify({'message': 'Login successful'}), 200
            except Exception:
                pass
        
        return jsonify({'message': 'Invalid credentials'}), 401
        
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    """Logout endpoint."""
    session.clear()
    return jsonify({'message': 'Logout successful'}), 200

@app.route('/invite_user', methods=['POST'])
@login_required
def invite_user():
    """Create an invitation for a new user."""
    try:
        data = request.get_json()
        if not data or 'email' not in data:
            return jsonify({'message': 'Email is required'}), 400
        
        email = data['email']
        
        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[-1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        user_id = session['user_id']
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if email already has an unused invitation
        cursor.execute(
            'SELECT invite_id FROM invitations WHERE email = ? AND used = 0',
            (email,)
        )
        existing_invitation = cursor.fetchone()
        
        if existing_invitation:
            conn.close()
            return jsonify({
                'invite_id': existing_invitation['invite_id'],
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Check if email is already registered
        cursor.execute(
            'SELECT id FROM users WHERE email = ?',
            (email,)
        )
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already registered'}), 400
        
        # Generate unique invite_id
        invite_id = secrets.token_urlsafe(32)
        
        # Insert invitation
        cursor.execute(
            '''INSERT INTO invitations (invite_id, email, invited_by_user_id) 
               VALUES (?, ?, ?)''',
            (invite_id, email, user_id)
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200
            
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    """Create a new user with a valid invitation."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        invite_id = data.get('invite_id')
        username = data.get('user_name')
        password = data.get('password')
        
        if not all([invite_id, username, password]):
            return jsonify({'message': 'Missing required fields'}), 400
        
        # Validate username (alphanumeric, underscores and hyphens only)
        valid_chars = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-')
        if not all(c in valid_chars for c in username):
            return jsonify({'message': 'Invalid username format'}), 400
        
        # Validate password strength
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if invitation exists and is unused
        cursor.execute(
            'SELECT id, email FROM invitations WHERE invite_id = ? AND used = 0',
            (invite_id,)
        )
        invitation = cursor.fetchone()
        
        if not invitation:
            conn.close()
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        # Check if username already exists
        cursor.execute(
            'SELECT id FROM users WHERE username = ?',
            (username,)
        )
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Hash password securely using argon2
        password_hash = argon2.hash(password)
        
        # Create user
        cursor.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            (username, password_hash, invitation['email'])
        )
        
        # Mark invitation as used
        cursor.execute(
            'UPDATE invitations SET used = 1 WHERE id = ?',
            (invitation['id'],)
        )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'User created successfully'}), 200
            
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle any unhandled exception."""
    return jsonify({'message': 'An error occurred'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)