import os
import sqlite3
import uuid
from flask import Flask, request, jsonify
from passlib.hash import bcrypt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            invite_id TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used INTEGER DEFAULT 0
        )
    ''')
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email']
    
    # Basic email validation
    if '@' not in email or '.' not in email:
        return jsonify({'message': 'Invalid email format'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if email already has an invitation
    cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
    existing = cursor.fetchone()
    
    if existing:
        invite_id = existing['invite_id']
        message = 'Invitation already exists for this email'
    else:
        # Generate new invite_id
        invite_id = str(uuid.uuid4())
        
        try:
            cursor.execute(
                'INSERT INTO invitations (email, invite_id) VALUES (?, ?)',
                (email, invite_id)
            )
            conn.commit()
            message = 'Invitation created successfully'
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Error creating invitation'}), 500
    
    conn.close()
    
    return jsonify({
        'invite_id': invite_id,
        'message': message
    }), 200

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    
    if not data:
        return jsonify({'message': 'Request body is required'}), 400
    
    invite_id = data.get('invite_id')
    user_name = data.get('user_name')
    password = data.get('password')
    
    if not invite_id or not user_name or not password:
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Verify invite_id exists and is not used
    cursor.execute('SELECT email, used FROM invitations WHERE invite_id = ?', (invite_id,))
    invitation = cursor.fetchone()
    
    if not invitation:
        conn.close()
        return jsonify({'message': 'Invalid invite_id'}), 401
    
    if invitation['used']:
        conn.close()
        return jsonify({'message': 'Invitation already used'}), 401
    
    email = invitation['email']
    
    # Check if username already exists
    cursor.execute('SELECT id FROM users WHERE username = ?', (user_name,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    
    # Check if email already has a user
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'message': 'Email already has an associated user'}), 400
    
    # Hash password
    password_hash = bcrypt.hash(password)
    
    try:
        # Create user
        cursor.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            (user_name, password_hash, email)
        )
        
        # Mark invitation as used
        cursor.execute('UPDATE invitations SET used = 1 WHERE invite_id = ?', (invite_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'User created successfully'}), 200
    
    except sqlite3.IntegrityError as e:
        conn.close()
        return jsonify({'message': 'Error creating user'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)