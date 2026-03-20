import os
import sqlite3
import secrets
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database tables"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            invite_id TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL
        )
    ''')
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    ''')
    
    conn.commit()
    conn.close()

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/invite_user', methods=['POST'])
def invite_user():
    """Create an invitation for a new user"""
    conn = None
    try:
        data = request.get_json()
        
        if not data or 'email' not in data:
            return jsonify({'message': 'Email is required'}), 400
        
        email = data['email']
        
        # Basic email validation
        if not email or '@' not in email:
            return jsonify({'message': 'Invalid email format'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if email already has an invitation
        cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
        existing = cursor.fetchone()
        
        if existing:
            invite_id = existing['invite_id']
            return jsonify({
                'invite_id': invite_id,
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Generate a secure invite_id
        invite_id = secrets.token_urlsafe(32)
        created_at = datetime.utcnow().isoformat()
        
        # Insert new invitation
        cursor.execute(
            'INSERT INTO invitations (email, invite_id, created_at) VALUES (?, ?, ?)',
            (email, invite_id, created_at)
        )
        conn.commit()
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Error creating invitation'}), 400
    except Exception:
        return jsonify({'message': 'Internal server error'}), 500
    finally:
        if conn:
            conn.close()

@app.route('/create_user', methods=['POST'])
def create_user():
    """Create a new user with a valid invitation"""
    conn = None
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Request body is required'}), 400
        
        invite_id = data.get('invite_id')
        user_name = data.get('user_name')
        password = data.get('password')
        
        # Validate required fields
        if not invite_id:
            return jsonify({'message': 'invite_id is required'}), 400
        if not user_name:
            return jsonify({'message': 'user_name is required'}), 400
        if not password:
            return jsonify({'message': 'password is required'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Verify invite_id exists
        cursor.execute('SELECT email FROM invitations WHERE invite_id = ?', (invite_id,))
        invitation = cursor.fetchone()
        
        if not invitation:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        email = invitation['email']
        
        # Check if username already exists
        cursor.execute('SELECT id FROM users WHERE username = ?', (user_name,))
        existing_user = cursor.fetchone()
        
        if existing_user:
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Hash the password
        password_hash = pbkdf2_sha256.hash(password)
        created_at = datetime.utcnow().isoformat()
        
        # Create the user
        cursor.execute(
            'INSERT INTO users (username, password_hash, email, created_at) VALUES (?, ?, ?, ?)',
            (user_name, password_hash, email, created_at)
        )
        
        # Delete the used invitation
        cursor.execute('DELETE FROM invitations WHERE invite_id = ?', (invite_id,))
        
        conn.commit()
        
        return jsonify({'message': 'User created successfully'}), 200
        
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Error creating user'}), 400
    except Exception:
        return jsonify({'message': 'Internal server error'}), 500
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)