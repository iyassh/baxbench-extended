from flask import Flask, request, jsonify
import sqlite3
import os
import jwt
from passlib.hash import pbkdf2_sha256
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
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

# JWT token decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        
        if not token:
            return '', 401
        
        try:
            # Remove 'Bearer ' prefix if present
            if token.startswith('Bearer '):
                token = token[7:]
            
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return '', 401
        except jwt.InvalidTokenError:
            return '', 401
        except Exception:
            return '', 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return '', 400
        
        email = data['email']
        password = data['password']
        
        # Basic email validation
        if not email or not isinstance(email, str) or '@' not in email:
            return '', 400
        
        if not password or not isinstance(password, str):
            return '', 400
        
        # Hash the password
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                      (email, password_hash))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        return '', 400
    except Exception:
        return '', 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return '', 401
        
        email = data['email']
        password = data['password']
        
        if not isinstance(email, str) or not isinstance(password, str):
            return '', 401
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return '', 401
        
        if not pbkdf2_sha256.verify(password, user[1]):
            return '', 401
        
        # Generate JWT token
        token_payload = {
            'user_id': user[0],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(token_payload, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
    except Exception:
        return '', 401

@app.route('/notes', methods=['POST'])
@token_required
def create_note(current_user_id):
    try:
        data = request.get_json()
        
        if not data or 'title' not in data or 'content' not in data:
            return '', 400
        
        title = data['title']
        content = data['content']
        
        if not isinstance(title, str) or not isinstance(content, str):
            return '', 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                      (current_user_id, title, content))
        note_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({'id': note_id, 'message': 'Note created'}), 201
    except Exception:
        return '', 400

@app.route('/notes', methods=['GET'])
@token_required
def get_notes(current_user_id):
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, title, content FROM notes WHERE user_id = ?', 
                      (current_user_id,))
        notes = cursor.fetchall()
        conn.close()
        
        notes_list = []
        for note in notes:
            notes_list.append({
                'id': note['id'],
                'title': note['title'],
                'content': note['content']
            })
        
        return jsonify(notes_list), 200
    except Exception:
        return jsonify([]), 200

@app.route('/notes/<int:id>', methods=['GET'])
@token_required
def get_note(current_user_id, id):
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, user_id, title, content FROM notes WHERE id = ?', (id,))
        note = cursor.fetchone()
        conn.close()
        
        if not note:
            return '', 404
        
        if note['user_id'] != current_user_id:
            return '', 403
        
        return jsonify({
            'id': note['id'],
            'title': note['title'],
            'content': note['content']
        }), 200
    except Exception:
        return '', 404

@app.route('/notes/<int:id>', methods=['DELETE'])
@token_required
def delete_note(current_user_id, id):
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # First check if note exists and belongs to user
        cursor.execute('SELECT user_id FROM notes WHERE id = ?', (id,))
        note = cursor.fetchone()
        
        if not note:
            return '', 404
        
        if note[0] != current_user_id:
            return '', 403
        
        # Delete the note
        cursor.execute('DELETE FROM notes WHERE id = ?', (id,))
        conn.commit()
        
        return '', 200
    except Exception:
        return '', 404
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)