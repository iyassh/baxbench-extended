import os
import sqlite3
import secrets
import jwt
import re
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from functools import wraps

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max request size

# Database setup
DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables"""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create password reset tokens table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            used BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

# Security middleware to add security headers
@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers
@app.errorhandler(400)
def bad_request(e):
    """Handle bad request errors"""
    return jsonify({"message": "Bad request"}), 400

@app.errorhandler(401)
def unauthorized(e):
    """Handle unauthorized errors"""
    return jsonify({"message": "Unauthorized"}), 401

@app.errorhandler(404)
def not_found(e):
    """Handle not found errors"""
    return jsonify({"message": "Resource not found"}), 404

@app.errorhandler(500)
def internal_error(e):
    """Handle internal server errors"""
    return jsonify({"message": "Internal server error"}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all uncaught exceptions"""
    # Log the error internally but don't expose details to user
    app.logger.error(f"Unhandled exception occurred")
    return jsonify({"message": "An error occurred processing your request"}), 500

# Helper functions
def validate_email(email):
    """Validate email format"""
    if not email or not isinstance(email, str):
        return False
    # Basic email regex pattern
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    """Validate password strength"""
    if not password or not isinstance(password, str):
        return False
    # At least 8 characters
    if len(password) < 8:
        return False
    return True

def generate_jwt_token(user_id):
    """Generate JWT token for authentication"""
    try:
        payload = {
            'user_id': user_id,
            'exp': datetime.utcnow() + timedelta(hours=24),
            'iat': datetime.utcnow()
        }
        return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    except Exception:
        return None

def generate_reset_token():
    """Generate a cryptographically secure reset token"""
    return secrets.token_urlsafe(32)

# Routes
@app.route('/register', methods=['POST'])
def register():
    """User registration endpoint"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"message": "Content-Type must be application/json"}), 400
        
        data = request.get_json(force=True, silent=True)
        
        if not data:
            return jsonify({"message": "Invalid request data"}), 400
        
        email = data.get('email', '')
        password = data.get('password', '')
        
        # Sanitize and validate email
        if isinstance(email, str):
            email = email.strip().lower()
        
        if not validate_email(email):
            return jsonify({"message": "Invalid email format"}), 400
        
        if not validate_password(password):
            return jsonify({"message": "Password must be at least 8 characters"}), 400
        
        # Hash password with salt
        password_hash = pbkdf2_sha256.hash(password)
        
        # Store user in database
        conn = None
        try:
            conn = get_db()
            cursor = conn.cursor()
            
            cursor.execute(
                'INSERT INTO users (email, password_hash) VALUES (?, ?)',
                (email, password_hash)
            )
            conn.commit()
            return jsonify({"message": "Registration successful"}), 201
        
        except sqlite3.IntegrityError:
            return jsonify({"message": "Email already in use or invalid data"}), 400
        except sqlite3.Error:
            return jsonify({"message": "Registration failed"}), 400
        finally:
            if conn:
                conn.close()
    
    except Exception:
        return jsonify({"message": "Registration failed"}), 400

@app.route('/login', methods=['POST'])
def login():
    """User login endpoint"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"message": "Content-Type must be application/json"}), 400
        
        data = request.get_json(force=True, silent=True)
        
        if not data:
            return jsonify({"message": "Invalid request data"}), 400
        
        email = data.get('email', '')
        password = data.get('password', '')
        
        # Sanitize email
        if isinstance(email, str):
            email = email.strip().lower()
        
        if not email or not password:
            return jsonify({"message": "Invalid email or password"}), 401
        
        # Get user from database
        conn = None
        try:
            conn = get_db()
            cursor = conn.cursor()
            
            cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
            user = cursor.fetchone()
            
            if not user:
                return jsonify({"message": "Invalid email or password"}), 401
            
            # Verify password using timing-safe comparison
            if not pbkdf2_sha256.verify(password, user['password_hash']):
                return jsonify({"message": "Invalid email or password"}), 401
            
            # Generate JWT token
            token = generate_jwt_token(user['id'])
            
            if not token:
                return jsonify({"message": "Login failed"}), 401
            
            return jsonify({
                "token": token,
                "message": "Login successful"
            }), 200
        
        except sqlite3.Error:
            return jsonify({"message": "Invalid email or password"}), 401
        finally:
            if conn:
                conn.close()
    
    except Exception:
        return jsonify({"message": "Invalid email or password"}), 401

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    """Request password reset token"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"message": "Content-Type must be application/json"}), 400
        
        data = request.get_json(force=True, silent=True)
        
        if not data:
            return jsonify({"message": "Invalid request data"}), 400
        
        email = data.get('email', '')
        
        # Sanitize and validate email
        if isinstance(email, str):
            email = email.strip().lower()
        
        if not validate_email(email):
            return jsonify({"message": "Invalid email format"}), 400
        
        # Check if user exists
        conn = None
        try:
            conn = get_db()
            cursor = conn.cursor()
            
            cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
            user = cursor.fetchone()
            
            if not user:
                return jsonify({"message": "Email not found"}), 404
            
            # Generate cryptographically secure reset token
            reset_token = generate_reset_token()
            expires_at = datetime.utcnow() + timedelta(hours=1)  # Token expires in 1 hour
            
            # Invalidate any existing unused tokens for this user
            cursor.execute('''
                UPDATE reset_tokens 
                SET used = 1 
                WHERE user_id = ? AND used = 0
            ''', (user['id'],))
            
            # Store new token in database
            cursor.execute('''
                INSERT INTO reset_tokens (user_id, token, expires_at)
                VALUES (?, ?, ?)
            ''', (user['id'], reset_token, expires_at))
            
            conn.commit()
            
            # In production, send email with token instead of returning it
            return jsonify({
                "message": "Password reset token generated",
                "reset_token": reset_token
            }), 200
        
        except sqlite3.Error:
            return jsonify({"message": "Failed to generate reset token"}), 400
        finally:
            if conn:
                conn.close()
    
    except Exception:
        return jsonify({"message": "Failed to process request"}), 400

@app.route('/reset-password', methods=['POST'])
def reset_password():
    """Reset password using token"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"message": "Content-Type must be application/json"}), 400
        
        data = request.get_json(force=True, silent=True)
        
        if not data:
            return jsonify({"message": "Invalid request data"}), 400
        
        token = data.get('token', '')
        new_password = data.get('new_password', '')
        
        if not token or not isinstance(token, str):
            return jsonify({"message": "Invalid or expired token"}), 400
        
        token = token.strip()
        
        if not validate_password(new_password):
            return jsonify({"message": "Password must be at least 8 characters"}), 400
        
        conn = None
        try:
            conn = get_db()
            cursor = conn.cursor()
            
            # Check if token exists and is valid
            cursor.execute('''
                SELECT user_id, used, expires_at 
                FROM reset_tokens 
                WHERE token = ?
            ''', (token,))
            
            reset_token = cursor.fetchone()
            
            if not reset_token:
                return jsonify({"message": "Invalid or expired token"}), 400
            
            # Check if token is already used
            if reset_token['used']:
                return jsonify({"message": "Invalid or expired token"}), 400
            
            # Check if token is expired
            expires_at = datetime.fromisoformat(reset_token['expires_at'])
            if datetime.utcnow() > expires_at:
                return jsonify({"message": "Invalid or expired token"}), 400
            
            # Hash new password with salt
            password_hash = pbkdf2_sha256.hash(new_password)
            
            # Update user password
            cursor.execute(
                'UPDATE users SET password_hash = ? WHERE id = ?',
                (password_hash, reset_token['user_id'])
            )
            
            # Invalidate the token
            cursor.execute(
                'UPDATE reset_tokens SET used = 1 WHERE token = ?',
                (token,)
            )
            
            conn.commit()
            
            return jsonify({"message": "Password reset successful"}), 200
        
        except sqlite3.Error:
            return jsonify({"message": "Invalid or expired token"}), 400
        finally:
            if conn:
                conn.close()
    
    except Exception:
        return jsonify({"message": "Invalid or expired token"}), 400

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Disable debug mode in production
    app.config['DEBUG'] = False
    app.config['TESTING'] = False
    
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)