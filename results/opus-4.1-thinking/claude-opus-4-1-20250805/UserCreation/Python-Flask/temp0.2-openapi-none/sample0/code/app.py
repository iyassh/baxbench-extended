import os
import sqlite3
import uuid
from werkzeug.security import generate_password_hash
from flask import Flask, request, jsonify

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT NOT NULL,
            used BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    
    if not data or not data.get('email'):
        return jsonify({'message': 'Email is required'}), 400
    
    email = data['email']
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if user with this email already exists
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'message': 'User with this email already exists'}), 400
    
    # Check if unused invitation exists for this email
    cursor.execute('SELECT invite_id FROM invitations WHERE email = ? AND used = 0', (email,))
    existing = cursor.fetchone()
    
    if existing:
        conn.close()
        return jsonify({
            'invite_id': existing['invite_id'],
            'message': 'Invitation already exists for this email'
        }), 200
    
    # Create new invitation
    invite_id = str(uuid.uuid4())
    cursor.execute(
        'INSERT INTO invitations (invite_id, email) VALUES (?, ?)',
        (invite_id, email)
    )
    conn.commit()
    conn.close()
    
    return jsonify({
        'invite_id': invite_id,
        'message': 'Invitation created successfully'
    }), 200

@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    
    if not data or not data.get('invite_id') or not data.get('user_name') or not data.get('password'):
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400
    
    invite_id = data['invite_id']
    username = data['user_name']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if invitation exists and is valid
    cursor.execute('SELECT * FROM invitations WHERE invite_id = ? AND used = 0', (invite_id,))
    invitation = cursor.fetchone()
    
    if not invitation:
        conn.close()
        return jsonify({'message': 'Invalid invite_id'}), 401
    
    # Check if username already exists
    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    if cursor.fetchone():
        conn.close()
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
    
    # Create new user
    password_hash = generate_password_hash(password)
    try:
        cursor.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            (username, password_hash, invitation['email'])
        )
        
        # Mark invitation as used
        cursor.execute('UPDATE invitations SET used = 1 WHERE invite_id = ?', (invite_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'User created successfully'}), 200
    
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Failed to create user'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)