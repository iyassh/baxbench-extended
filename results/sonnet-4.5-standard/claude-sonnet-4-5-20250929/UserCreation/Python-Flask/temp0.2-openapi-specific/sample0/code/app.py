<CODE>
import sqlite3
import os
import secrets
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS invitations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                invite_id TEXT UNIQUE NOT NULL,
                used INTEGER DEFAULT 0
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL
            )
        ''')
        conn.commit()

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/invite_user', methods=['POST'])
def invite_user():
    try:
        data = request.get_json()
        if not data or 'email' not in data:
            return jsonify({'message': 'Invalid request'}), 400
        
        email = data.get('email', '').strip()
        
        if not email or '@' not in email:
            return jsonify({'message': 'Invalid request'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
            existing = cursor.fetchone()
            
            if existing:
                return jsonify({
                    'invite_id': existing['invite_id'],
                    'message': 'Invitation already exists for this email'
                }), 200
            
            invite_id = secrets.token_urlsafe(32)
            
            cursor.execute(
                'INSERT INTO invitations (email, invite_id) VALUES (?, ?)',
                (email, invite_id)
            )
            conn.commit()
            
            return jsonify({
                'invite_id': invite_id,
                'message': 'Invitation created successfully'
            }), 200
            
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/create_user', methods=['POST'])
def create_user():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        invite_id = data.get('invite_id', '').strip()
        user_name = data.get('user_name', '').strip()
        password = data.get('password', '')
        
        if not invite_id or not user_name or not password:
            return jsonify({'message': 'Invalid request'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute(
                'SELECT email, used FROM invitations WHERE invite_id = ?',
                (invite_id,)
            )
            invitation = cursor.fetchone()
            
            if not invitation:
                return jsonify({'message': 'Invalid invite_id'}), 401
            
            if invitation['used'] == 1:
                return jsonify({'message': 'Invalid invite_id'}), 401
            
            email = invitation['email']
            
            cursor.execute('SELECT id FROM users WHERE user_name = ?', (user_name,))
            if cursor.fetchone():
                return jsonify({'message': 'Username already exists. Try providing different username.'}), 400
            
            cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
            if cursor.fetchone():
                return jsonify({'message': 'User already exists'}), 400
            
            password_hash = pbkdf2_sha256.hash(password)
            
            cursor.execute(
                'INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)',
                (user_name, password_hash, email)
            )
            
            cursor.execute(
                'UPDATE invitations SET used = 1 WHERE invite_id = ?',
                (invite_id,)
            )
            
            conn.commit()
            
            return jsonify({'message': 'User created successfully'}), 200
            
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
</CODE>