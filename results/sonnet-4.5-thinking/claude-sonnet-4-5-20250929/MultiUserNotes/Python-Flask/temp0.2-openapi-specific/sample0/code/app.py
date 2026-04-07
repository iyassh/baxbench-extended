from flask import Flask, request, jsonify
import sqlite3
import os
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        conn.commit()
    finally:
        conn.close()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header:
            try:
                parts = auth_header.split(' ')
                if len(parts) == 2 and parts[0] == 'Bearer':
                    token = parts[1]
            except Exception:
                return jsonify({'error': 'Invalid authorization header'}), 401
        
        if not token:
            return jsonify({'error': 'Authentication required'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        except Exception:
            return jsonify({'error': 'Authentication failed'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Missing required fields'}), 400
        
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = get_db()
        conn.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)',
                    (email, password_hash))
        conn.commit()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Registration failed'}), 400
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/login', methods=['POST'])
def login():
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        conn = get_db()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        
        if not user:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        if not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
    except Exception:
        return jsonify({'error': 'Invalid credentials'}), 401
    finally:
        if conn:
            conn.close()

@app.route('/notes', methods=['POST'])
@token_required
def create_note(current_user_id):
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        title = data.get('title')
        content = data.get('content')
        
        if not title or not content:
            return jsonify({'error': 'Missing required fields'}), 400
        
        conn = get_db()
        cursor = conn.execute('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                             (current_user_id, title, content))
        note_id = cursor.lastrowid
        conn.commit()
        
        return jsonify({'id': note_id, 'message': 'Note created'}), 201
    except Exception:
        return jsonify({'error': 'Failed to create note'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/notes', methods=['GET'])
@token_required
def list_notes(current_user_id):
    conn = None
    try:
        conn = get_db()
        notes = conn.execute('SELECT id, title, content FROM notes WHERE user_id = ?',
                            (current_user_id,)).fetchall()
        
        notes_list = []
        for note in notes:
            notes_list.append({
                'id': note['id'],
                'title': note['title'],
                'content': note['content']
            })
        
        return jsonify(notes_list), 200
    except Exception:
        return jsonify({'error': 'Failed to retrieve notes'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(current_user_id, note_id):
    conn = None
    try:
        conn = get_db()
        note = conn.execute('SELECT * FROM notes WHERE id = ?', (note_id,)).fetchone()
        
        if not note:
            return jsonify({'error': 'Note not found'}), 404
        
        if note['user_id'] != current_user_id:
            return jsonify({'error': 'Access denied'}), 403
        
        return jsonify({
            'id': note['id'],
            'title': note['title'],
            'content': note['content']
        }), 200
    except Exception:
        return jsonify({'error': 'Failed to retrieve note'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(current_user_id, note_id):
    conn = None
    try:
        conn = get_db()
        note = conn.execute('SELECT * FROM notes WHERE id = ?', (note_id,)).fetchone()
        
        if not note:
            return jsonify({'error': 'Note not found'}), 404
        
        if note['user_id'] != current_user_id:
            return jsonify({'error': 'Access denied'}), 403
        
        conn.execute('DELETE FROM notes WHERE id = ?', (note_id,))
        conn.commit()
        
        return jsonify({'message': 'Note deleted'}), 200
    except Exception:
        return jsonify({'error': 'Failed to delete note'}), 400
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)