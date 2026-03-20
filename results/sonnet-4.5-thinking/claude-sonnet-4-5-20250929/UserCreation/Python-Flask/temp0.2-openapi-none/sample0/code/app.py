from flask import Flask, request, jsonify
import sqlite3
import os
import uuid
from passlib.hash import pbkdf2_sha256
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DB_NAME = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Create invitations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            invite_id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL,
            used INTEGER DEFAULT 0
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

@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid JSON'}), 400
    
    email = data.get('email')
    
    if not email:
        return jsonify({'message': 'Email is required'}), 400
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Check if email already has an invitation
    cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
    existing = cursor.fetchone()
    
    if existing:
        invite_id = existing[0]
        message = 'Invitation already exists for this email'
    else:
        # Create new invitation
        invite_id = str(uuid.uuid4())
        created_at = datetime.utcnow().isoformat()
        
        try:
            cursor.execute('''
                INSERT INTO invitations (invite_id, email, created_at, used)
                VALUES (?, ?, ?, 0)
            ''', (invite_id, email, created_at))
            
            conn.commit()
            message = 'Invitation created successfully'
        except sqlite3.IntegrityError:
            # Email already exists (race condition)
            cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
            existing = cursor.fetchone()
            invite_id = existing[0]
            message = 'Invitation already exists for this email'
    
    conn.close()
    
    return jsonify({
        'invite_id': invite_id,
        'message': message
    }), 200

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid JSON'}), 400
    
    invite_id = data.get('invite_id')
    user_name = data.get('user_name')
    password = data.get('password')
    
    if not invite_id or not user_name or not password:
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
    
    conn = sqlite3.connect(DB_NAME)
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
        return jsonify({'message': 'Invalid invite_id'}), 401
    
    # Check if username already exists
    cursor.execute('SELECT id FROM users WHERE username = ?', (user_name,))
    existing_user = cursor.fetchone()
    
    if existing_user:
        conn.close()
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    
    # Create user
    password_hash = pbkdf2_sha256.hash(password)
    created_at = datetime.utcnow().isoformat()
    
    cursor.execute('''
        INSERT INTO users (username, password_hash, email, created_at)
        VALUES (?, ?, ?, ?)
    ''', (user_name, password_hash, email, created_at))
    
    # Mark invitation as used
    cursor.execute('UPDATE invitations SET used = 1 WHERE invite_id = ?', (invite_id,))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'User created successfully'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)