import sqlite3
import os
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from functools import wraps
from passlib.hash import bcrypt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    
    # Create notes table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# JWT token decorator
def token_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get('Authorization')
        
        if not token:
            return jsonify({'error': 'Token is missing'}), 401
            
        if token.startswith('Bearer '):
            token = token[7:]  # Remove 'Bearer ' prefix
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated_function

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Email and password required'}), 400
    
    email = data['email']
    password = data['password']
    
    # Hash the password
    password_hash = bcrypt.hash(password)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                      (email, password_hash))
        conn.commit()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already in use'}), 400
    finally:
        conn.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Email and password required'}), 401
    
    email = data['email']
    password = data['password']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if user and bcrypt.verify(password, user[1]):
        # Generate JWT token
        token = jwt.encode({
            'user_id': user[0],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
    else:
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/notes', methods=['POST'])
@token_required
def create_note(current_user_id):
    data = request.get_json()
    
    if not data or not data.get('title') or not data.get('content'):
        return jsonify({'error': 'Title and content required'}), 400
    
    title = data['title']
    content = data['content']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('INSERT INTO notes (title, content, user_id) VALUES (?, ?, ?)',
                  (title, content, current_user_id))
    note_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return jsonify({'id': note_id, 'message': 'Note created'}), 201

@app.route('/notes', methods=['GET'])
@token_required
def get_notes(current_user_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, title, content FROM notes WHERE user_id = ?', 
                  (current_user_id,))
    notes = cursor.fetchall()
    conn.close()
    
    notes_list = []
    for note in notes:
        notes_list.append({
            'id': note[0],
            'title': note[1],
            'content': note[2]
        })
    
    return jsonify(notes_list), 200

@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(current_user_id, note_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, title, content, user_id FROM notes WHERE id = ?', 
                  (note_id,))
    note = cursor.fetchone()
    conn.close()
    
    if not note:
        return jsonify({'error': 'Note not found'}), 404
    
    if note[3] != current_user_id:
        return jsonify({'error': 'Forbidden'}), 403
    
    return jsonify({
        'id': note[0],
        'title': note[1],
        'content': note[2]
    }), 200

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(current_user_id, note_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # First check if note exists and belongs to user
    cursor.execute('SELECT user_id FROM notes WHERE id = ?', (note_id,))
    note = cursor.fetchone()
    
    if not note:
        conn.close()
        return jsonify({'error': 'Note not found'}), 404
    
    if note[0] != current_user_id:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    # Delete the note
    cursor.execute('DELETE FROM notes WHERE id = ?', (note_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Note deleted'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)