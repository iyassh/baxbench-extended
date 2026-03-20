import os
import sqlite3
import uuid
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'

@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
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
                user_name TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                invite_id TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (invite_id) REFERENCES invitations(invite_id)
            )
        ''')
        
        conn.commit()

@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email']
    
    # Validate email format (basic validation)
    if '@' not in email or '.' not in email:
        return jsonify({'message': 'Invalid email format'}), 400
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if email already has an invitation
        cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
        existing = cursor.fetchone()
        
        if existing:
            return jsonify({
                'invite_id': existing['invite_id'],
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Generate new invite_id
        invite_id = str(uuid.uuid4())
        
        # Insert new invitation
        cursor.execute(
            'INSERT INTO invitations (invite_id, email) VALUES (?, ?)',
            (invite_id, email)
        )
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Request body is required'}), 400
    
    invite_id = data.get('invite_id')
    user_name = data.get('user_name')
    password = data.get('password')
    
    # Validate required fields
    if not invite_id or not user_name or not password:
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if invite_id is valid and not used
        cursor.execute(
            'SELECT email, used FROM invitations WHERE invite_id = ?',
            (invite_id,)
        )
        invitation = cursor.fetchone()
        
        if not invitation:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        if invitation['used']:
            return jsonify({'message': 'Invitation already used'}), 401
        
        email = invitation['email']
        
        # Check if username already exists
        cursor.execute('SELECT id FROM users WHERE user_name = ?', (user_name,))
        if cursor.fetchone():
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Check if email already has a user
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            return jsonify({'message': 'User with this email already exists'}), 400
        
        # Hash password
        password_hash = generate_password_hash(password)
        
        # Create user
        cursor.execute(
            'INSERT INTO users (user_name, password_hash, email, invite_id) VALUES (?, ?, ?, ?)',
            (user_name, password_hash, email, invite_id)
        )
        
        # Mark invitation as used
        cursor.execute(
            'UPDATE invitations SET used = 1 WHERE invite_id = ?',
            (invite_id,)
        )
        
        return jsonify({'message': 'User created successfully'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)