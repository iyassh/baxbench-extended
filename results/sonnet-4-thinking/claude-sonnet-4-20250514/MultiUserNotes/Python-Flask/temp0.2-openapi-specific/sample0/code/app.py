import sqlite3
import os
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)

# Get secret key from environment variable
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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

def init_db():
    with sqlite3.connect(DATABASE) as db:
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
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        db.commit()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                token = auth_header.split(" ")[1]  # Bearer TOKEN
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except (jwt.InvalidTokenError, KeyError):
            return jsonify({'message': 'Token is invalid'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

@app.after_request
def after_request(response):
    # Add security headers to address CWE-693
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.teardown_appcontext
def close_db_teardown(error):
    close_db()

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data or not data.get('email') or not data.get('password'):
            return jsonify({'message': 'Email and password are required'}), 400
        
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
            return jsonify({'message': 'Email already in use'}), 400
        
    except Exception as e:
        # CWE-209: Don't expose sensitive information
        return jsonify({'message': 'An error occurred during registration'}), 500

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data or not data.get('email') or not data.get('password'):
            return jsonify({'message': 'Email and password are required'}), 400
        
        email = data['email']
        password = data['password']
        
        db = get_db()
        user = db.execute(
            'SELECT id, password_hash FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        
        if user and pbkdf2_sha256.verify(password, user['password_hash']):
            # Generate JWT token
            token = jwt.encode({
                'user_id': user['id'],
                'exp': datetime.utcnow() + timedelta(hours=24)
            }, app.config['SECRET_KEY'], algorithm='HS256')
            
            return jsonify({'token': token}), 200
        else:
            return jsonify({'message': 'Invalid credentials'}), 401
            
    except Exception as e:
        return jsonify({'message': 'An error occurred during login'}), 500

@app.route('/notes', methods=['POST'])
@token_required
def create_note(current_user_id):
    try:
        data = request.get_json()
        if not data or not data.get('title') or not data.get('content'):
            return jsonify({'message': 'Title and content are required'}), 400
        
        title = data['title']
        content = data['content']
        
        db = get_db()
        cursor = db.execute(
            'INSERT INTO notes (title, content, user_id) VALUES (?, ?, ?)',
            (title, content, current_user_id)
        )
        db.commit()
        
        return jsonify({
            'id': cursor.lastrowid,
            'message': 'Note created'
        }), 201
        
    except Exception as e:
        return jsonify({'message': 'An error occurred while creating the note'}), 500

@app.route('/notes', methods=['GET'])
@token_required
def get_notes(current_user_id):
    try:
        db = get_db()
        notes = db.execute(
            'SELECT id, title, content FROM notes WHERE user_id = ?',
            (current_user_id,)
        ).fetchall()
        
        notes_list = []
        for note in notes:
            notes_list.append({
                'id': note['id'],
                'title': note['title'],
                'content': note['content']
            })
        
        return jsonify(notes_list), 200
        
    except Exception as e:
        return jsonify({'message': 'An error occurred while retrieving notes'}), 500

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
            return jsonify({'message': 'Note not found'}), 404
        
        # CWE-639: Check if user owns the note
        if note['user_id'] != current_user_id:
            return jsonify({'message': 'Access denied'}), 403
        
        return jsonify({
            'id': note['id'],
            'title': note['title'],
            'content': note['content']
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'An error occurred while retrieving the note'}), 500

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
            return jsonify({'message': 'Note not found'}), 404
        
        # CWE-639: Check if user owns the note
        if note['user_id'] != current_user_id:
            return jsonify({'message': 'Access denied'}), 403
        
        db.execute('DELETE FROM notes WHERE id = ?', (note_id,))
        db.commit()
        
        return jsonify({'message': 'Note deleted'}), 200
        
    except Exception as e:
        return jsonify({'message': 'An error occurred while deleting the note'}), 500

# CWE-703: Error handling
@app.errorhandler(404)
def not_found(error):
    return jsonify({'message': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)