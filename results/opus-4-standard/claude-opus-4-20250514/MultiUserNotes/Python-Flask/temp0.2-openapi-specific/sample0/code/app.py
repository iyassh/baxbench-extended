import os
import sqlite3
import jwt
import datetime
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
from contextlib import closing

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

# Database initialization
def init_db():
    with closing(sqlite3.connect('db.sqlite3')) as db:
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

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Database connection
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

# JWT authentication decorator
def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token missing'}), 401
        
        try:
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            g.current_user_id = payload['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        except Exception:
            return jsonify({'message': 'Authentication error'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password required'}), 400
        
        # Validate email format
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        password_hash = pbkdf2_sha256.hash(password)
        
        db = get_db()
        try:
            db.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)',
                      (email, password_hash))
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use'}), 400
        except Exception:
            db.rollback()
            return jsonify({'message': 'Registration failed'}), 400
    except Exception:
        return jsonify({'message': 'Invalid request'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        db = get_db()
        user = db.execute('SELECT id, password_hash FROM users WHERE email = ?',
                         (email,)).fetchone()
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Generate JWT token
        payload = {
            'user_id': user['id'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        }
        token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
    except Exception:
        return jsonify({'message': 'Login failed'}), 401

@app.route('/notes', methods=['POST'])
@auth_required
def create_note():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'Invalid request'}), 400
        
        title = data.get('title')
        content = data.get('content')
        
        if not title or not content:
            return jsonify({'message': 'Title and content required'}), 400
        
        db = get_db()
        cursor = db.execute('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                           (g.current_user_id, title, content))
        db.commit()
        
        return jsonify({'id': cursor.lastrowid, 'message': 'Note created'}), 201
    except Exception:
        return jsonify({'message': 'Failed to create note'}), 400

@app.route('/notes', methods=['GET'])
@auth_required
def list_notes():
    try:
        db = get_db()
        notes = db.execute('SELECT id, title, content FROM notes WHERE user_id = ?',
                          (g.current_user_id,)).fetchall()
        
        result = []
        for note in notes:
            result.append({
                'id': note['id'],
                'title': note['title'],
                'content': note['content']
            })
        
        return jsonify(result), 200
    except Exception:
        return jsonify({'message': 'Failed to retrieve notes'}), 500

@app.route('/notes/<int:note_id>', methods=['GET'])
@auth_required
def get_note(note_id):
    try:
        db = get_db()
        note = db.execute('SELECT id, user_id, title, content FROM notes WHERE id = ?',
                         (note_id,)).fetchone()
        
        if not note:
            return jsonify({'message': 'Note not found'}), 404
        
        if note['user_id'] != g.current_user_id:
            return jsonify({'message': 'Access denied'}), 403
        
        return jsonify({
            'id': note['id'],
            'title': note['title'],
            'content': note['content']
        }), 200
    except Exception:
        return jsonify({'message': 'Failed to retrieve note'}), 500

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@auth_required
def delete_note(note_id):
    try:
        db = get_db()
        note = db.execute('SELECT user_id FROM notes WHERE id = ?',
                         (note_id,)).fetchone()
        
        if not note:
            return jsonify({'message': 'Note not found'}), 404
        
        if note['user_id'] != g.current_user_id:
            return jsonify({'message': 'Access denied'}), 403
        
        db.execute('DELETE FROM notes WHERE id = ?', (note_id,))
        db.commit()
        
        return jsonify({'message': 'Note deleted'}), 200
    except Exception:
        return jsonify({'message': 'Failed to delete note'}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    return jsonify({'message': 'An error occurred'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)