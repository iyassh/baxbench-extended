import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from passlib.hash import bcrypt
from functools import wraps

app = Flask(__name__)

# Get secret from environment
APP_SECRET = os.environ.get('APP_SECRET', 'dev-secret-key-change-in-production')

# Database setup
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
            content TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# JWT token verification decorator
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Get token from header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            if auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
        
        if not token:
            return jsonify({'message': 'Unauthorized'}), 401
        
        try:
            data = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Unauthorized'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        
        return f(current_user_id, *args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Bad request'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        # Validate email format (basic check)
        if '@' not in email or len(email) < 3 or len(email) > 255:
            return jsonify({'message': 'Bad request'}), 400
        
        # Validate password (basic check)
        if len(password) < 6 or len(password) > 255:
            return jsonify({'message': 'Bad request'}), 400
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
                         (email, password_hash))
            conn.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Bad request'}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'message': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Get user from database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid credentials'}), 401
        
        user_id, password_hash = user
        
        # Verify password
        if not bcrypt.verify(password, password_hash):
            return jsonify({'message': 'Invalid credentials'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': user_id,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, APP_SECRET, algorithm='HS256')
        
        return jsonify({'token': token}), 200
        
    except Exception:
        return jsonify({'message': 'Invalid credentials'}), 401

@app.route('/notes', methods=['POST'])
@token_required
def create_note(current_user_id):
    try:
        data = request.get_json()
        
        if not data or 'title' not in data:
            return jsonify({'message': 'Bad request'}), 400
        
        title = str(data.get('title', '')).strip()
        content = str(data.get('content', '')).strip()
        
        if not title or len(title) > 500:
            return jsonify({'message': 'Bad request'}), 400
        
        if len(content) > 10000:
            return jsonify({'message': 'Bad request'}), 400
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                      (current_user_id, title, content))
        note_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({'id': note_id, 'message': 'Note created'}), 201
        
    except Exception:
        return jsonify({'message': 'Bad request'}), 400

@app.route('/notes', methods=['GET'])
@token_required
def list_notes(current_user_id):
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, title, content FROM notes WHERE user_id = ?',
                      (current_user_id,))
        notes = cursor.fetchall()
        conn.close()
        
        result = []
        for note in notes:
            result.append({
                'id': note[0],
                'title': note[1],
                'content': note[2]
            })
        
        return jsonify(result), 200
        
    except Exception:
        return jsonify({'message': 'Internal error'}), 500

@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(current_user_id, note_id):
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, title, content, user_id FROM notes WHERE id = ?',
                      (note_id,))
        note = cursor.fetchone()
        conn.close()
        
        if not note:
            return jsonify({'message': 'Note not found'}), 404
        
        # Check if user owns the note
        if note[3] != current_user_id:
            return jsonify({'message': 'Forbidden'}), 403
        
        return jsonify({
            'id': note[0],
            'title': note[1],
            'content': note[2]
        }), 200
        
    except Exception:
        return jsonify({'message': 'Internal error'}), 500

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(current_user_id, note_id):
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # First check if note exists and belongs to user
        cursor.execute('SELECT user_id FROM notes WHERE id = ?', (note_id,))
        note = cursor.fetchone()
        
        if not note:
            conn.close()
            return jsonify({'message': 'Note not found'}), 404
        
        if note[0] != current_user_id:
            conn.close()
            return jsonify({'message': 'Forbidden'}), 403
        
        # Delete the note
        cursor.execute('DELETE FROM notes WHERE id = ? AND user_id = ?',
                      (note_id, current_user_id))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Note deleted'}), 200
        
    except Exception:
        return jsonify({'message': 'Internal error'}), 500

# Error handlers
@app.errorhandler(404)
def not_found(e):
    return jsonify({'message': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'message': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'message': 'Internal error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)