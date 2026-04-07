import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'fallback-secret-key')

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
def close_db_teardown(error):
    close_db()

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.execute('''
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

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Unauthorized'}), 401
        
        token = auth_header[7:]
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return f(current_user_id, *args, **kwargs)
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Bad request'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Bad request'}), 400
        
        if '@' not in email:
            return jsonify({'message': 'Bad request'}), 400
        
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
            return jsonify({'message': 'Bad request'}), 400
    except:
        return jsonify({'message': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        db = get_db()
        user = db.execute(
            'SELECT id, password_hash FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        
        if user and pbkdf2_sha256.verify(password, user['password_hash']):
            token = jwt.encode({
                'user_id': user['id'],
                'exp': datetime.utcnow() + timedelta(hours=24)
            }, app.config['SECRET_KEY'], algorithm='HS256')
            return jsonify({'token': token})
        else:
            return jsonify({'message': 'Invalid credentials'}), 401
    except:
        return jsonify({'message': 'Invalid credentials'}), 401

@app.route('/notes', methods=['POST'])
@token_required
def create_note(current_user_id):
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Bad request'}), 400
        
        title = data.get('title')
        content = data.get('content')
        
        if not title or not content:
            return jsonify({'message': 'Bad request'}), 400
        
        db = get_db()
        cursor = db.execute(
            'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
            (current_user_id, title, content)
        )
        db.commit()
        
        return jsonify({'id': cursor.lastrowid, 'message': 'Note created'}), 201
    except:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/notes', methods=['GET'])
@token_required
def get_notes(current_user_id):
    try:
        db = get_db()
        notes = db.execute(
            'SELECT id, title, content FROM notes WHERE user_id = ?',
            (current_user_id,)
        ).fetchall()
        
        return jsonify([{
            'id': note['id'],
            'title': note['title'],
            'content': note['content']
        } for note in notes])
    except:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(current_user_id, note_id):
    try:
        db = get_db()
        note = db.execute(
            'SELECT id, title, content, user_id FROM notes WHERE id = ?',
            (note_id,)
        ).fetchone()
        
        if not note:
            return jsonify({'message': 'Not found'}), 404
        
        if note['user_id'] != current_user_id:
            return jsonify({'message': 'Forbidden'}), 403
        
        return jsonify({
            'id': note['id'],
            'title': note['title'],
            'content': note['content']
        })
    except:
        return jsonify({'message': 'Internal server error'}), 500

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(current_user_id, note_id):
    try:
        db = get_db()
        note = db.execute(
            'SELECT user_id FROM notes WHERE id = ?',
            (note_id,)
        ).fetchone()
        
        if not note:
            return jsonify({'message': 'Not found'}), 404
        
        if note['user_id'] != current_user_id:
            return jsonify({'message': 'Forbidden'}), 403
        
        db.execute('DELETE FROM notes WHERE id = ?', (note_id,))
        db.commit()
        
        return jsonify({'message': 'Note deleted'})
    except:
        return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)