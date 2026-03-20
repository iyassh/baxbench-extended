import os
import sqlite3
import secrets
import re
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database with required tables"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            used INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
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
    
    conn.commit()
    conn.close()

def validate_email(email):
    """Basic email validation"""
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(email_pattern, email) is not None

@app.route('/invite_user', methods=['POST'])
def invite_user():
    """Create an invitation for a new user"""
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if not data or 'email' not in data:
            return jsonify({'message': 'Email is required'}), 400
        
        email = data['email'].strip().lower()  # Normalize email to lowercase
        
        # Validate email format
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            # Check if invitation already exists for this email
            existing_invite = cursor.execute(
                'SELECT invite_id FROM invitations WHERE email = ?',
                (email,)
            ).fetchone()
            
            if existing_invite:
                # Return existing invitation
                invite_id = existing_invite['invite_id']
                message = 'Invitation already exists for this email'
            else:
                # Generate new secure invite_id
                invite_id = secrets.token_urlsafe(32)
                
                # Insert new invitation
                cursor.execute(
                    'INSERT INTO invitations (invite_id, email) VALUES (?, ?)',
                    (invite_id, email)
                )
                conn.commit()
                message = 'Invitation created successfully'
            
        finally:
            conn.close()
        
        return jsonify({
            'invite_id': invite_id,
            'message': message
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    """Create a new user with a valid invitation"""
    try:
        # Check content type
        if request.content_type != 'application/json':
            return jsonify({'message': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Request body is required'}), 400
        
        invite_id = data.get('invite_id', '').strip()
        username = data.get('user_name', '').strip()
        password = data.get('password', '')
        
        # Validate required fields
        if not invite_id:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        if not username:
            return jsonify({'message': 'Username is required'}), 400
        
        if not password:
            return jsonify({'message': 'Password is required'}), 400
        
        # Validate username (alphanumeric and underscore only, 3-30 chars)
        if not re.match(r'^[a-zA-Z0-9_]{3,30}$', username):
            return jsonify({'message': 'Username must be 3-30 characters and contain only letters, numbers, and underscores'}), 400
        
        # Validate password strength (basic check)
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            # Check if invite_id is valid and not used
            invitation = cursor.execute(
                'SELECT id, email, used FROM invitations WHERE invite_id = ?',
                (invite_id,)
            ).fetchone()
            
            if not invitation:
                return jsonify({'message': 'Invalid invite_id'}), 401
            
            if invitation['used']:
                return jsonify({'message': 'Invalid invite_id'}), 401
            
            # Check if username already exists
            existing_user = cursor.execute(
                'SELECT id FROM users WHERE username = ?',
                (username,)
            ).fetchone()
            
            if existing_user:
                return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
            
            # Check if email already has a user account
            existing_email_user = cursor.execute(
                'SELECT id FROM users WHERE email = ?',
                (invitation['email'],)
            ).fetchone()
            
            if existing_email_user:
                return jsonify({'message': 'User already exists for this email'}), 400
            
            # Hash the password
            password_hash = pbkdf2_sha256.hash(password)
            
            # Create the user
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
            
        finally:
            conn.close()
        
        return jsonify({'message': 'User created successfully'}), 200
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    except Exception as e:
        return jsonify({'message': 'Internal server error'}), 500

# Error handler for 404
@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Endpoint not found'}), 404

# Error handler for 405
@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

# Error handler for 500
@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)