import os
import sqlite3
import jwt
import json
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
from werkzeug.exceptions import BadRequest, Unauthorized, Forbidden, NotFound

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-dev')

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
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

# Database connection helper
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
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'error': 'Invalid authorization header format'}), 401
        
        if not token:
            return jsonify({'error': 'Authorization required'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            db = get_db()
            cursor = db.cursor()
            cursor.execute('SELECT id, email FROM users WHERE id = ?', (data['user_id'],))
            current_user = cursor.fetchone()
            
            if not current_user:
                return jsonify({'error': 'Invalid token'}), 401
            
            g.current_user_id = current_user['id']
            g.current_user_email = current_user['email']
            
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        except Exception:
            return jsonify({'error': 'Authentication failed'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

# Error handlers
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(401)
def unauthorized(e):
    return jsonify({'error': 'Unauthorized'}), 401

@app.errorhandler(403)
def forbidden(e):
    return jsonify({'error': 'Forbidden'}), 403

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

# Routes
@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request data'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        # Basic email validation
        if '@' not in email or len(email) < 3:
            return jsonify({'error': 'Invalid email format'}), 400
        
        if len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        password_hash = pbkdf2_sha256.hash(password)
        
        db = get_db()
        cursor = db.cursor()
        
        try:
            cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                         (email, password_hash))
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Email already in use'}), 400
        
    except Exception:
        return jsonify({'error': 'Registration failed'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request data'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id, email, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        
        if not user or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
        
    except Exception:
        return jsonify({'error': 'Login failed'}), 401

@app.route('/notes', methods=['POST'])
@token_required
def create_note():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request data'}), 400
        
        title = data.get('title')
        content = data.get('content')
        
        if not title or not content:
            return jsonify({'error': 'Title and content are required'}), 400
        
        db = get_db()
        cursor = db.cursor()
        cursor.execute('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                      (g.current_user_id, title, content))
        db.commit()
        note_id = cursor.lastrowid
        
        return jsonify({'id': note_id, 'message': 'Note created'}), 201
        
    except Exception:
        return jsonify({'error': 'Failed to create note'}), 400

@app.route('/notes', methods=['GET'])
@token_required
def list_notes():
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
                      (g.current_user_id,))
        notes = cursor.fetchall()
        
        notes_list = []
        for note in notes:
            notes_list.append({
                'id': note['id'],
                'title': note['title'],
                'content': note['content']
            })
        
        return jsonify(notes_list), 200
        
    except Exception:
        return jsonify({'error': 'Failed to retrieve notes'}), 500

@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(note_id):
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute('SELECT id, user_id, title, content FROM notes WHERE id = ?', (note_id,))
        note = cursor.fetchone()
        
        if not note:
            return jsonify({'error': 'Note not found'}), 404
        
        if note['user_id'] != g.current_user_id:
            return jsonify({'error': 'Access denied'}), 403
        
        return jsonify({
            'id': note['id'],
            'title': note['title'],
            'content': note['content']
        }), 200
        
    except Exception:
        return jsonify({'error': 'Failed to retrieve note'}), 500

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(note_id):
    try:
        db = get_db()
        cursor = db.cursor()
        
        cursor.execute('SELECT user_id FROM notes WHERE id = ?', (note_id,))
        note = cursor.fetchone()
        
        if not note:
            return jsonify({'error': 'Note not found'}), 404
        
        if note['user_id'] != g.current_user_id:
            return jsonify({'error': 'Access denied'}), 403
        
        cursor.execute('DELETE FROM notes WHERE id = ?', (note_id,))
        db.commit()
        
        return jsonify({'message': 'Note deleted'}), 200
        
    except Exception:
        return jsonify({'error': 'Failed to delete note'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)