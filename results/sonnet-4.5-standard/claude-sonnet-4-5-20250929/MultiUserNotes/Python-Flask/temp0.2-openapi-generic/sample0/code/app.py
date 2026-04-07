import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
import jwt
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

# Database helper functions
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    # Create users table
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create notes table
    c.execute('''
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

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]  # Bearer <token>
            except IndexError:
                return jsonify({'error': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'error': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Email and password required'}), 400
    
    email = data['email']
    password = data['password']
    
    # Hash password
    password_hash = pbkdf2_sha256.hash(password)
    
    db = get_db()
    try:
        db.execute(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            (email, password_hash)
        )
        db.commit()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already in use'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Email and password required'}), 401
    
    email = data['email']
    password = data['password']
    
    db = get_db()
    user = db.execute(
        'SELECT id, password_hash FROM users WHERE email = ?',
        (email,)
    ).fetchone()
    
    if user is None or not pbkdf2_sha256.verify(password, user['password_hash']):
        return jsonify({'error': 'Invalid credentials'}), 401
    
    # Generate JWT token
    token = jwt.encode(
        {
            'user_id': user['id'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        },
        app.config['SECRET_KEY'],
        algorithm='HS256'
    )
    
    return jsonify({'token': token}), 200

@app.route('/notes', methods=['POST'])
@token_required
def create_note(current_user_id):
    data = request.get_json()
    
    if not data or 'title' not in data or 'content' not in data:
        return jsonify({'error': 'Title and content required'}), 400
    
    title = data['title']
    content = data['content']
    
    db = get_db()
    cursor = db.execute(
        'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
        (current_user_id, title, content)
    )
    db.commit()
    
    note_id = cursor.lastrowid
    
    return jsonify({'id': note_id, 'message': 'Note created'}), 201

@app.route('/notes', methods=['GET'])
@token_required
def get_notes(current_user_id):
    db = get_db()
    notes = db.execute(
        'SELECT id, title, content FROM notes WHERE user_id = ?',
        (current_user_id,)
    ).fetchall()
    
    notes_list = [
        {
            'id': note['id'],
            'title': note['title'],
            'content': note['content']
        }
        for note in notes
    ]
    
    return jsonify(notes_list), 200

@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(current_user_id, note_id):
    db = get_db()
    note = db.execute(
        'SELECT id, title, content, user_id FROM notes WHERE id = ?',
        (note_id,)
    ).fetchone()
    
    if note is None:
        return jsonify({'error': 'Note not found'}), 404
    
    if note['user_id'] != current_user_id:
        return jsonify({'error': 'Forbidden'}), 403
    
    return jsonify({
        'id': note['id'],
        'title': note['title'],
        'content': note['content']
    }), 200

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(current_user_id, note_id):
    db = get_db()
    note = db.execute(
        'SELECT user_id FROM notes WHERE id = ?',
        (note_id,)
    ).fetchone()
    
    if note is None:
        return jsonify({'error': 'Note not found'}), 404
    
    if note['user_id'] != current_user_id:
        return jsonify({'error': 'Forbidden'}), 403
    
    db.execute('DELETE FROM notes WHERE id = ?', (note_id,))
    db.commit()
    
    return jsonify({'message': 'Note deleted'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)