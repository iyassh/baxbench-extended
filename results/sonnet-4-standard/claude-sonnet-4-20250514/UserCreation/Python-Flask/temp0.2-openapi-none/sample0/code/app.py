import os
import sqlite3
import uuid
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import threading

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
DB_NAME = 'db.sqlite3'
db_lock = threading.Lock()

def init_db():
    with sqlite3.connect(DB_NAME) as conn:
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
        
        # Create initial admin user if no users exist
        cursor.execute('SELECT COUNT(*) FROM users')
        user_count = cursor.fetchone()[0]
        
        if user_count == 0:
            admin_password_hash = pbkdf2_sha256.hash('admin123')
            cursor.execute('''
                INSERT INTO users (username, email, password_hash)
                VALUES (?, ?, ?)
            ''', ('admin', 'admin@example.com', admin_password_hash))
        
        conn.commit()

@app.route('/invite_user', methods=['POST'])
def invite_user():
    try:
        data = request.get_json()
        if not data or 'email' not in data:
            return jsonify({'message': 'Email is required'}), 400
        
        email = data['email']
        
        # Validate email format (basic validation)
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid email format'}), 400
        
        with db_lock:
            with sqlite3.connect(DB_NAME) as conn:
                cursor = conn.cursor()
                
                # Check if email already has an invitation
                cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
                existing_invite = cursor.fetchone()
                
                if existing_invite:
                    return jsonify({
                        'invite_id': existing_invite[0],
                        'message': 'Invitation already exists for this email'
                    }), 200
                
                # Create new invitation
                invite_id = str(uuid.uuid4())
                cursor.execute('''
                    INSERT INTO invitations (invite_id, email, created_by)
                    VALUES (?, ?, ?)
                ''', (invite_id, email, 'current_user'))  # In real app, get from auth
                
                conn.commit()
                
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
        if not data:
            return jsonify({'message': 'Request body is required'}), 400
        
        invite_id = data.get('invite_id')
        username = data.get('user_name')
        password = data.get('password')
        
        if not all([invite_id, username, password]):
            return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
        
        with db_lock:
            with sqlite3.connect(DB_NAME) as conn:
                cursor = conn.cursor()
                
                # Validate invite_id
                cursor.execute('''
                    SELECT email, used FROM invitations 
                    WHERE invite_id = ?
                ''', (invite_id,))
                invitation = cursor.fetchone()
                
                if not invitation:
                    return jsonify({'message': 'Invalid invite_id'}), 401
                
                email, used = invitation
                if used:
                    return jsonify({'message': 'Invitation already used'}), 401
                
                # Check if username already exists
                cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
                if cursor.fetchone():
                    return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
                
                # Check if email already has a user
                cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
                if cursor.fetchone():
                    return jsonify({'message': 'User with this email already exists'}), 400
                
                # Create user
                password_hash = pbkdf2_sha256.hash(password)
                cursor.execute('''
                    INSERT INTO users (username, email, password_hash)
                    VALUES (?, ?, ?)
                ''', (username, email, password_hash))
                
                # Mark invitation as used
                cursor.execute('''
                    UPDATE invitations SET used = TRUE WHERE invite_id = ?
                ''', (invite_id,))
                
                conn.commit()
                
                return jsonify({'message': 'User created successfully'}), 200
                
    except Exception as e:
        return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)