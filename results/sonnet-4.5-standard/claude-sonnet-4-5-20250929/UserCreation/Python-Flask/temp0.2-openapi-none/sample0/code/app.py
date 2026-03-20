<CODE>
import os
import sqlite3
import uuid
from flask import Flask, request, jsonify
from passlib.hash import sha256_crypt
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            used INTEGER DEFAULT 0
        )
    ''')
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
        )
    ''')
    
    conn.commit()
    conn.close()

@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

@app.route('/invite_user', methods=['POST'])
def invite_user():
    """Create an invitation for a new user."""
    data = request.get_json()
    
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email']
    
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
        conn.commit()
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200

@app.route('/create_user', methods=['POST'])
def create_user():
    """Create a new user with a valid invitation."""
    data = request.get_json()
    
    if not data or 'invite_id' not in data or 'user_name' not in data or 'password' not in data:
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
    
    invite_id = data['invite_id']
    user_name = data['user_name']
    password = data['password']
    
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
        
        # Hash the password
        password_hash = sha256_crypt.hash(password)
        
        # Create the user
        cursor.execute(
            'INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)',
            (user_name, password_hash, email)
        )
        
        # Mark invitation as used
        cursor.execute(
            'UPDATE invitations SET used = 1 WHERE invite_id = ?',
            (invite_id,)
        )
        
        conn.commit()
        
        return jsonify({'message': 'User created successfully'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
</CODE>