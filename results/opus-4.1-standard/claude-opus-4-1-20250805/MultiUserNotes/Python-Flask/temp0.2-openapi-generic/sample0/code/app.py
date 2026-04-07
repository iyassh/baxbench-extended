from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from datetime import datetime, timedelta, timezone
from passlib.hash import pbkdf2_sha256
from functools import wraps
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    
    # Notes table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Email validation helper
def is_valid_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

# JWT token required decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            parts = auth_header.split(' ')
            if len(parts) == 2 and parts[0] == 'Bearer':
                token = parts[1]
        
        if not token:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Validate email format
        if not is_valid_email(email):
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Validate password strength (at least 6 characters)
        if len(password) < 6:
            return jsonify({'message': 'Password must be at least 6 characters'}), 400
        
        # Hash the password
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                          (email.lower(), password_hash))
            conn.commit()
            conn.close()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use'}), 400
    except Exception as e:
        return jsonify({'message': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email.lower(),))
        user = cursor.fetchone()
        conn.close()
        
        if not user or not pbkdf2_sha256.verify(password, user[1]):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': user[0],
            'exp': datetime.now(timezone.utc) + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
    except Exception as e:
        return jsonify({'message': 'Invalid request'}), 400

@app.route('/notes', methods=['POST'])
@token_required
def create_note(current_user_id):
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400
        
        title = data.get('title')
        content = data.get('content')
        
        if not title or not content:
            return jsonify({'message': 'Title and content are required'}), 400
        
        # Sanitize input
        title = str(title).strip()
        content = str(content).strip()
        
        if not title or not content:
            return jsonify({'message': 'Title and content cannot be empty'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                      (current_user_id, title, content))
        note_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({'id': note_id, 'message': 'Note created'}), 201
    except Exception as e:
        return jsonify({'message': 'Failed to create note'}), 400

@app.route('/notes', methods=['GET'])
@token_required
def get_notes(current_user_id):
    try:
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
    except Exception as e:
        return jsonify({'message': 'Failed to retrieve notes'}), 500

@app.route('/notes/<int:id>', methods=['GET'])
@token_required
def get_note(current_user_id, id):
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, title, content, user_id FROM notes WHERE id = ?', (id,))
        note = cursor.fetchone()
        conn.close()
        
        if not note:
            return jsonify({'message': 'Note not found'}), 404
        
        if note[3] != current_user_id:
            return jsonify({'message': 'Forbidden'}), 403
        
        return jsonify({
            'id': note[0],
            'title': note[1],
            'content': note[2]
        }), 200
    except Exception as e:
        return jsonify({'message': 'Failed to retrieve note'}), 500

@app.route('/notes/<int:id>', methods=['DELETE'])
@token_required
def delete_note(current_user_id, id):
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if note exists and belongs to user
        cursor.execute('SELECT user_id FROM notes WHERE id = ?', (id,))
        note = cursor.fetchone()
        
        if not note:
            conn.close()
            return jsonify({'message': 'Note not found'}), 404
        
        if note[0] != current_user_id:
            conn.close()
            return jsonify({'message': 'Forbidden'}), 403
        
        cursor.execute('DELETE FROM notes WHERE id = ?', (id,))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Note deleted'}), 200
    except Exception as e:
        return jsonify({'message': 'Failed to delete note'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)