import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

import jwt
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key')

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Notes table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect('db.sqlite3')
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(error):
    db = g.pop('db', None)
    if db is not None:
        db.close()

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            token = auth_header.split(' ')[1]
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, IndexError, KeyError):
            return jsonify({'error': 'Unauthorized'}), 401
        
        g.current_user_id = current_user_id
        return f(*args, **kwargs)
    
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Bad request'}), 400
        
        email = data['email']
        password = data['password']
        
        # Basic email validation
        if not email or '@' not in email:
            return jsonify({'error': 'Bad request'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        db = get_db()
        cursor = db.cursor()
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                      (email, password_hash))
        db.commit()
        return jsonify({'message': 'Registration successful'}), 201
        
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already in use'}), 400
    except Exception:
        return jsonify({'error': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        email = data['email']
        password = data['password']
        
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
        
    except Exception:
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/notes', methods=['POST'])
@token_required
def create_note():
    data = request.get_json()
    if not data or 'title' not in data or 'content' not in data:
        return jsonify({'error': 'Unauthorized'}), 401
    
    title = data['title']
    content = data['content']
    user_id = g.current_user_id
    
    db = get_db()
    cursor = db.cursor()
    cursor.execute('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                  (user_id, title, content))
    note_id = cursor.lastrowid
    db.commit()
    
    return jsonify({'id': note_id, 'message': 'Note created'}), 201

@app.route('/notes', methods=['GET'])
@token_required
def get_notes():
    user_id = g.current_user_id
    
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
                  (user_id,))
    notes = cursor.fetchall()
    
    notes_list = []
    for note in notes:
        notes_list.append({
            'id': note['id'],
            'title': note['title'],
            'content': note['content']
        })
    
    return jsonify(notes_list), 200

@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(note_id):
    user_id = g.current_user_id
    
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT id, title, content, user_id FROM notes WHERE id = ?', (note_id,))
    note = cursor.fetchone()
    
    if not note:
        return jsonify({'error': 'Note not found'}), 404
    
    if note['user_id'] != user_id:
        return jsonify({'error': 'Forbidden'}), 403
    
    return jsonify({
        'id': note['id'],
        'title': note['title'],
        'content': note['content']
    }), 200

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(note_id):
    user_id = g.current_user_id
    
    db = get_db()
    cursor = db.cursor()
    
    # Check if note exists and belongs to user
    cursor.execute('SELECT user_id FROM notes WHERE id = ?', (note_id,))
    note = cursor.fetchone()
    
    if not note:
        return jsonify({'error': 'Note not found'}), 404
    
    if note['user_id'] != user_id:
        return jsonify({'error': 'Forbidden'}), 403
    
    # Delete the note
    cursor.execute('DELETE FROM notes WHERE id = ?', (note_id,))
    db.commit()
    
    return jsonify({'message': 'Note deleted'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)