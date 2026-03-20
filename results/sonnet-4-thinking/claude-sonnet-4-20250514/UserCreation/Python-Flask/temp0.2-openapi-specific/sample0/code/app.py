from flask import Flask, request, jsonify
import sqlite3
import os
import uuid
import re
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

def init_db():
    """Initialize the database with required tables."""
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Create users table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create invitations table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS invitations (
                invite_id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                used INTEGER DEFAULT 0
            )
        ''')
        
        conn.commit()
    except sqlite3.Error:
        pass  # Handle database initialization errors gracefully
    finally:
        if conn:
            conn.close()

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def is_valid_email(email):
    """Validate email format."""
    if not email or not isinstance(email, str) or len(email) > 254:
        return False
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def is_valid_username(username):
    """Validate username format and length."""
    if not username or not isinstance(username, str) or len(username) < 3 or len(username) > 50:
        return False
    return re.match(r'^[a-zA-Z0-9_]+$', username) is not None

@app.route('/invite_user', methods=['POST'])
def invite_user():
    """Create an invitation for a new user."""
    conn = None
    try:
        if not request.is_json:
            return jsonify({'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if not data or 'email' not in data:
            return jsonify({'message': 'Email is required'}), 400
        
        email = data['email']
        
        if not is_valid_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if email already has an unused invitation
        cursor.execute('SELECT invite_id FROM invitations WHERE email = ? AND used = 0', (email,))
        existing_invite = cursor.fetchone()
        
        if existing_invite:
            invite_id = existing_invite[0]
            message = "Invitation already exists for this email"
        else:
            invite_id = str(uuid.uuid4())
            cursor.execute('INSERT INTO invitations (invite_id, email) VALUES (?, ?)', (invite_id, email))
            conn.commit()
            message = "Invitation created successfully"
        
        return jsonify({
            'invite_id': invite_id,
            'message': message
        }), 200
        
    except sqlite3.Error:
        if conn:
            conn.rollback()
        return jsonify({'message': 'Database error'}), 500
    except Exception:
        return jsonify({'message': 'Invalid request'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/create_user', methods=['POST'])
def create_user():
    """Create a new user with a valid invitation."""
    conn = None
    try:
        if not request.is_json:
            return jsonify({'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        required_fields = ['invite_id', 'user_name', 'password']
        if not data or not all(key in data for key in required_fields):
            return jsonify({'message': 'Missing required fields'}), 400
        
        invite_id = data['invite_id']
        username = data['user_name']
        password = data['password']
        
        # Validate inputs
        if not isinstance(invite_id, str) or len(invite_id.strip()) == 0:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        if not is_valid_username(username):
            return jsonify({'message': 'Invalid username'}), 400
        
        if not password or not isinstance(password, str) or len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if invitation exists and is not used
        cursor.execute('SELECT email FROM invitations WHERE invite_id = ? AND used = 0', (invite_id.strip(),))
        invitation = cursor.fetchone()
        
        if not invitation:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        email = invitation[0]
        
        # Check if username already exists
        cursor.execute('SELECT id FROM users WHERE username = ?', (username.strip(),))
        if cursor.fetchone():
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Hash password securely
        password_hash = pbkdf2_sha256.hash(password)
        
        # Create user and mark invitation as used
        cursor.execute('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)', 
                     (username.strip(), password_hash, email))
        cursor.execute('UPDATE invitations SET used = 1 WHERE invite_id = ?', (invite_id.strip(),))
        
        conn.commit()
        
        return jsonify({'message': 'User created successfully'}), 200
        
    except sqlite3.Error:
        if conn:
            conn.rollback()
        return jsonify({'message': 'Database error'}), 500
    except Exception:
        return jsonify({'message': 'Invalid request'}), 400
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)