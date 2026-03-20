import os
import sqlite3
import uuid
import hashlib
import secrets
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))

DATABASE = 'db.sqlite3'

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()

@app.teardown_appcontext
def close_db(error):
    close_db()

def init_db():
    with app.app_context():
        db = get_db()
        db.executescript('''
            CREATE TABLE IF NOT EXISTS invitations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invite_id TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                used BOOLEAN DEFAULT FALSE
            );
            
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ''')
        db.commit()

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_username(username):
    if not username or len(username) < 3 or len(username) > 50:
        return False
    pattern = r'^[a-zA-Z0-9_-]+$'
    return re.match(pattern, username) is not None

def validate_password(password):
    return password and len(password) >= 8

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    return jsonify({'message': 'An internal error occurred'}), 500

@app.route('/invite_user', methods=['POST'])
def invite_user():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid JSON data'}), 400
        
        email = data.get('email', '').strip().lower()
        
        if not email or not validate_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        db = get_db()
        
        # Check if email is already registered
        existing_user = db.execute(
            'SELECT id FROM users WHERE email = ?', (email,)
        ).fetchone()
        
        if existing_user:
            return jsonify({'message': 'Email already registered'}), 400
        
        # Check if invitation already exists
        existing_invitation = db.execute(
            'SELECT invite_id FROM invitations WHERE email = ?', (email,)
        ).fetchone()
        
        if existing_invitation:
            return jsonify({
                'invite_id': existing_invitation['invite_id'],
                'message': 'Invitation already exists for this email'
            }), 200
        
        # Create new invitation
        invite_id = str(uuid.uuid4())
        
        db.execute(
            'INSERT INTO invitations (invite_id, email) VALUES (?, ?)',
            (invite_id, email)
        )
        db.commit()
        
        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200
        
    except Exception:
        return jsonify({'message': 'An internal error occurred'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid JSON data'}), 400
        
        invite_id = data.get('invite_id', '').strip()
        username = data.get('user_name', '').strip()
        password = data.get('password', '')
        
        if not invite_id or not username or not password:
            return jsonify({'message': 'Missing required fields'}), 400
        
        if not validate_username(username):
            return jsonify({'message': 'Invalid username format'}), 400
        
        if not validate_password(password):
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400
        
        db = get_db()
        
        # Verify invitation
        invitation = db.execute(
            'SELECT email, used FROM invitations WHERE invite_id = ?', (invite_id,)
        ).fetchone()
        
        if not invitation:
            return jsonify({'message': 'Invalid invite_id'}), 401
        
        if invitation['used']:
            return jsonify({'message': 'Invitation already used'}), 401
        
        # Check if username already exists
        existing_user = db.execute(
            'SELECT id FROM users WHERE username = ?', (username,)
        ).fetchone()
        
        if existing_user:
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
        
        # Create user
        password_hash = generate_password_hash(password)
        
        db.execute(
            'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
            (username, password_hash, invitation['email'])
        )
        
        # Mark invitation as used
        db.execute(
            'UPDATE invitations SET used = TRUE WHERE invite_id = ?', (invite_id,)
        )
        
        db.commit()
        
        return jsonify({'message': 'User created successfully'}), 200
        
    except Exception:
        return jsonify({'message': 'An internal error occurred'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)