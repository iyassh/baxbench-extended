import os
import sqlite3
import uuid
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DB_NAME = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            used INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Create a default admin user if no users exist
    conn.commit()
    conn.close()

@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email'].strip().lower()
    
    if not email:
        return jsonify({'message': 'Email cannot be empty'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Check if invitation already exists for this email
        cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
        existing = cursor.fetchone()
        
        if existing:
            invite_id = existing['invite_id']
            message = 'Invitation already exists for this email.'
        else:
            invite_id = str(uuid.uuid4())
            cursor.execute(
                'INSERT INTO invitations (invite_id, email) VALUES (?, ?)',
                (invite_id, email)
            )
            conn.commit()
            message = 'Invitation created successfully.'
        
        return jsonify({'invite_id': invite_id, 'message': message}), 200
    finally:
        conn.close()

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Request body is required'}), 400
    
    invite_id = data.get('invite_id', '').strip()
    user_name = data.get('user_name', '').strip()
    password = data.get('password', '')
    
    if not invite_id:
        return jsonify({'message': 'invite_id is required'}), 401
    
    if not user_name:
        return jsonify({'message': 'user_name is required'}), 400
    
    if not password:
        return jsonify({'message': 'password is required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Validate invite_id
        cursor.execute('SELECT id, used FROM invitations WHERE invite_id = ?', (invite_id,))
        invitation = cursor.fetchone()
        
        if not invitation:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        if invitation['used']:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        # Check if username already exists
        cursor.execute('SELECT id FROM users WHERE user_name = ?', (user_name,))
        existing_user = cursor.fetchone()
        
        if existing_user:
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Create the user
        password_hash = generate_password_hash(password)
        cursor.execute(
            'INSERT INTO users (user_name, password_hash) VALUES (?, ?)',
            (user_name, password_hash)
        )
        
        # Mark invitation as used
        cursor.execute(
            'UPDATE invitations SET used = 1 WHERE invite_id = ?',
            (invite_id,)
        )
        
        conn.commit()
        return jsonify({'message': 'User created successfully.'}), 200
    finally:
        conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)