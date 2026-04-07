from flask import Flask, request, jsonify
import sqlite3
import os
from passlib.hash import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
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
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Authentication decorator
def auth_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return '', 401
        
        try:
            # Extract token from "Bearer <token>"
            parts = auth_header.split(' ')
            if len(parts) != 2 or parts[0] != 'Bearer':
                return '', 401
            
            token = parts[1]
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except Exception:
            return '', 401
        
        return f(current_user_id, *args, **kwargs)
    return decorated_function

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return '', 400
    
    email = data['email']
    password = data['password']
    
    # Hash password
    password_hash = bcrypt.hash(password)
    
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                      (email, password_hash))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return '', 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return '', 400
    
    email = data['email']
    password = data['password']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        return '', 401
    
    user_id, password_hash = user
    
    if not bcrypt.verify(password, password_hash):
        return '', 401
    
    # Generate JWT token
    token = jwt.encode({
        'user_id': user_id,
        'exp': datetime.now(timezone.utc) + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({'token': token}), 200

@app.route('/notes', methods=['POST'])
@auth_required
def create_note(current_user_id):
    data = request.get_json()
    
    if not data or 'title' not in data or 'content' not in data:
        return '', 400
    
    title = data['title']
    content = data['content']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                  (current_user_id, title, content))
    note_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return jsonify({'id': note_id, 'message': 'Note created'}), 201

@app.route('/notes', methods=['GET'])
@auth_required
def list_notes(current_user_id):
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
@auth_required
def get_note(current_user_id, note_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, user_id, title, content FROM notes WHERE id = ?', 
                  (note_id,))
    note = cursor.fetchone()
    conn.close()
    
    if not note:
        return '', 404
    
    if note[1] != current_user_id:
        return '', 403
    
    return jsonify({
        'id': note[0],
        'title': note[2],
        'content': note[3]
    }), 200

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@auth_required
def delete_note(current_user_id, note_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Check if note exists and belongs to user
    cursor.execute('SELECT user_id FROM notes WHERE id = ?', (note_id,))
    note = cursor.fetchone()
    
    if not note:
        conn.close()
        return '', 404
    
    if note[0] != current_user_id:
        conn.close()
        return '', 403
    
    # Delete the note
    cursor.execute('DELETE FROM notes WHERE id = ?', (note_id,))
    conn.commit()
    conn.close()
    
    return '', 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)