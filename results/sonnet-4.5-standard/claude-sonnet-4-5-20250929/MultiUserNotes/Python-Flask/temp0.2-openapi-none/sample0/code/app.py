import os
import sqlite3
from flask import Flask, request, jsonify, g
from functools import wraps
import jwt
from passlib.hash import pbkdf2_sha256
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')
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
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        db.commit()

# Authentication decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Token format invalid'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except:
            return jsonify({'message': 'Token is invalid'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Email and password required'}), 400
    
    email = data['email']
    password = data['password']
    
    db = get_db()
    
    # Check if user already exists
    user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    if user:
        return jsonify({'message': 'Email already in use'}), 400
    
    # Hash password and create user
    password_hash = pbkdf2_sha256.hash(password)
    db.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
               (email, password_hash))
    db.commit()
    
    return jsonify({'message': 'Registration successful'}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    email = data['email']
    password = data['password']
    
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    
    if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
        return jsonify({'message': 'Invalid credentials'}), 401
    
    # Generate JWT token
    token = jwt.encode({
        'user_id': user['id'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm='HS256')
    
    return jsonify({'token': token}), 200

@app.route('/notes', methods=['POST'])
@token_required
def create_note(current_user_id):
    data = request.get_json()
    
    if not data or not data.get('title') or not data.get('content'):
        return jsonify({'message': 'Title and content required'}), 400
    
    title = data['title']
    content = data['content']
    
    db = get_db()
    cursor = db.execute('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                       (current_user_id, title, content))
    db.commit()
    
    return jsonify({'id': cursor.lastrowid, 'message': 'Note created'}), 201

@app.route('/notes', methods=['GET'])
@token_required
def get_notes(current_user_id):
    db = get_db()
    notes = db.execute('SELECT id, title, content FROM notes WHERE user_id = ?',
                      (current_user_id,)).fetchall()
    
    notes_list = [dict(note) for note in notes]
    return jsonify(notes_list), 200

@app.route('/notes/<int:id>', methods=['GET'])
@token_required
def get_note(current_user_id, id):
    db = get_db()
    note = db.execute('SELECT id, title, content, user_id FROM notes WHERE id = ?',
                     (id,)).fetchone()
    
    if not note:
        return jsonify({'message': 'Note not found'}), 404
    
    if note['user_id'] != current_user_id:
        return jsonify({'message': 'Forbidden'}), 403
    
    return jsonify({'id': note['id'], 'title': note['title'], 'content': note['content']}), 200

@app.route('/notes/<int:id>', methods=['DELETE'])
@token_required
def delete_note(current_user_id, id):
    db = get_db()
    note = db.execute('SELECT user_id FROM notes WHERE id = ?', (id,)).fetchone()
    
    if not note:
        return jsonify({'message': 'Note not found'}), 404
    
    if note['user_id'] != current_user_id:
        return jsonify({'message': 'Forbidden'}), 403
    
    db.execute('DELETE FROM notes WHERE id = ?', (id,))
    db.commit()
    
    return jsonify({'message': 'Note deleted'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)