import os
import sqlite3
import uuid
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            created_by TEXT,
            used BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create a default admin user if no users exist
    cursor.execute('SELECT COUNT(*) FROM users')
    user_count = cursor.fetchone()[0]
    
    if user_count == 0:
        admin_password_hash = generate_password_hash('admin123')
        cursor.execute('''
            INSERT INTO users (username, email, password_hash)
            VALUES (?, ?, ?)
        ''', ('admin', 'admin@example.com', admin_password_hash))
    
    conn.commit()
    conn.close()

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_username(username):
    # Username should be alphanumeric and between 3-50 characters
    if not username or len(username) < 3 or len(username) > 50:
        return False
    return re.match(r'^[a-zA-Z0-9_]+$', username) is not None

def validate_password(password):
    # Password should be at least 6 characters
    return password and len(password) >= 6

@app.route('/invite_user', methods=['POST'])
def invite_user():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data:
            return jsonify({'message': 'Email is required'}), 400
        
        email = data['email'].strip().lower()
        
        if not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if email is already registered as a user
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'User with this email already exists'}), 400
        
        # Check if invitation already exists for this email
        cursor.execute('SELECT invite_id FROM invitations WHERE email = ? AND used = FALSE', (email,))
        existing_invite = cursor.fetchone()
        
        if existing_invite:
            conn.close()
            return jsonify({
                'invite_id': existing_invite[0],
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Create new invitation
        invite_id = str(uuid.uuid4())
        cursor.execute('''
            INSERT INTO invitations (invite_id, email, created_by)
            VALUES (?, ?, ?)
        ''', (invite_id, email, 'current_user'))  # In a real app, this would be the authenticated user
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    try:
        data = request.get_json()
        
        if not data or not all(key in data for key in ['invite_id', 'user_name', 'password']):
            return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
        
        invite_id = data['invite_id'].strip()
        username = data['user_name'].strip()
        password = data['password']
        
        # Validate input
        if not validate_username(username):
            return jsonify({'message': 'Username must be 3-50 characters long and contain only letters, numbers, and underscores'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Password must be at least 6 characters long'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if invite_id is valid and not used
        cursor.execute('SELECT email, used FROM invitations WHERE invite_id = ?', (invite_id,))
        invitation = cursor.fetchone()
        
        if not invitation:
            conn.close()
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        email, used = invitation
        
        if used:
            conn.close()
            return jsonify({'message': 'Invitation has already been used'}), 401
        
        # Check if username already exists
        cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Check if email already has a user (shouldn't happen if invitations are managed properly)
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'User with this email already exists'}), 400
        
        # Create user
        password_hash = generate_password_hash(password)
        cursor.execute('''
            INSERT INTO users (username, email, password_hash)
            VALUES (?, ?, ?)
        ''', (username, email, password_hash))
        
        # Mark invitation as used
        cursor.execute('UPDATE invitations SET used = TRUE WHERE invite_id = ?', (invite_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'User created successfully'}), 200
        
    except sqlite3.IntegrityError as e:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    except Exception as e:
        return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)