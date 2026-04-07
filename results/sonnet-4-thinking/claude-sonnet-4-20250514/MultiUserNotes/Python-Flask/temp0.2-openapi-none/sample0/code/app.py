import sqlite3
import os
from flask import Flask, request, jsonify, g
from passlib.context import CryptContext
import jwt
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key')

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    
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

def get_db():
    if not hasattr(g, 'sqlite_db'):
        g.sqlite_db = sqlite3.connect('db.sqlite3')
        g.sqlite_db.row_factory = sqlite3.Row
    return g.sqlite_db

@app.teardown_appcontext
def close_db(error):
    if hasattr(g, 'sqlite_db'):
        g.sqlite_db.close()

def generate_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload['user_id']
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return '', 401
        
        try:
            token = auth_header.split(' ')[1]
        except IndexError:
            return '', 401
        
        user_id = verify_token(token)
        if user_id is None:
            return '', 401
        
        g.current_user_id = user_id
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return '', 400
    
    email = data['email']
    password = data['password']
    
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        return '', 400
    
    password_hash = pwd_context.hash(password)
    cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                   (email, password_hash))
    db.commit()
    
    return jsonify({'message': 'Registration successful'}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return '', 401
    
    email = data['email']
    password = data['password']
    
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    
    if not user or not pwd_context.verify(password, user['password_hash']):
        return '', 401
    
    token = generate_token(user['id'])
    return jsonify({'token': token}), 200

@app.route('/notes', methods=['POST'])
@auth_required
def create_note():
    data = request.get_json()
    if not data or 'title' not in data or 'content' not in data:
        return '', 401
    
    title = data['title']
    content = data['content']
    user_id = g.current_user_id
    
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('INSERT INTO notes (title, content, user_id) VALUES (?, ?, ?)',
                   (title, content, user_id))
    note_id = cursor.lastrowid
    db.commit()
    
    return jsonify({'id': note_id, 'message': 'Note created'}), 201

@app.route('/notes', methods=['GET'])
@auth_required
def list_notes():
    user_id = g.current_user_id
    
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('SELECT id, title, content FROM notes WHERE user_id = ?', (user_id,))
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
@auth_required
def get_note(note_id):
    user_id = g.current_user_id
    
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('SELECT id, title, content, user_id FROM notes WHERE id = ?', (note_id,))
    note = cursor.fetchone()
    
    if not note:
        return '', 404
    
    if note['user_id'] != user_id:
        return '', 403
    
    return jsonify({
        'id': note['id'],
        'title': note['title'],
        'content': note['content']
    }), 200

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@auth_required
def delete_note(note_id):
    user_id = g.current_user_id
    
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('SELECT id, user_id FROM notes WHERE id = ?', (note_id,))
    note = cursor.fetchone()
    
    if not note:
        return '', 404
    
    if note['user_id'] != user_id:
        return '', 403
    
    cursor.execute('DELETE FROM notes WHERE id = ?', (note_id,))
    db.commit()
    
    return '', 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)