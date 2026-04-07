import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps

import jwt
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-dev')

# Database setup
DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection for the current request context."""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    """Close database connection at the end of request."""
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    """Initialize the database with required tables."""
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        db.commit()

# Security headers middleware (CWE-693)
@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Authentication decorator
def token_required(f):
    """Decorator to require valid JWT token for protected routes."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization', '')
        
        if auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
        
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = data['user_id']
            g.current_user_id = current_user_id
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, KeyError):
            return jsonify({'error': 'Unauthorized'}), 401
        except Exception:
            # CWE-209: Don't expose sensitive error information
            return jsonify({'error': 'Unauthorized'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

# Routes
@app.route('/register', methods=['POST'])
def register():
    """Register a new user."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Bad request'}), 400
            
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Bad request'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'error': 'Bad request'}), 400
        
        # Hash the password
        password_hash = bcrypt.hash(password)
        
        # Try to insert the user
        db = get_db()
        try:
            db.execute(
                'INSERT INTO users (email, password_hash) VALUES (?, ?)',
                (email, password_hash)
            )
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            # Email already exists
            return jsonify({'error': 'Bad request'}), 400
        except Exception:
            # CWE-703: Handle exceptions properly
            db.rollback()
            return jsonify({'error': 'Bad request'}), 400
    except Exception:
        # CWE-209: Don't expose sensitive error information
        return jsonify({'error': 'Bad request'}), 400

@app.route('/login', methods=['POST'])
def login():
    """Authenticate user and return JWT token."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid credentials'}), 401
            
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Get user from database
        db = get_db()
        user = db.execute(
            'SELECT id, password_hash FROM users WHERE email = ?',
            (email,)
        ).fetchone()
        
        if not user:
            # Don't reveal whether email exists
            return jsonify({'error': 'Invalid credentials'}), 401
            
        # Verify password
        try:
            if not bcrypt.verify(password, user['password_hash']):
                return jsonify({'error': 'Invalid credentials'}), 401
        except Exception:
            # CWE-703: Handle password verification errors
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({'token': token}), 200
    except Exception:
        # CWE-209: Don't expose sensitive error information
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/notes', methods=['POST'])
@token_required
def create_note():
    """Create a new note for the authenticated user."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Bad request'}), 400
            
        title = data.get('title', '').strip()
        content = data.get('content', '')
        
        if not title:
            return jsonify({'error': 'Bad request'}), 400
        
        user_id = g.current_user_id
        
        # Insert note
        db = get_db()
        try:
            cursor = db.execute(
                'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                (user_id, title, content)
            )
            db.commit()
            
            return jsonify({
                'id': cursor.lastrowid,
                'message': 'Note created'
            }), 201
        except Exception:
            # CWE-703: Handle database errors properly
            db.rollback()
            return jsonify({'error': 'Failed to create note'}), 500
    except Exception:
        return jsonify({'error': 'Bad request'}), 400

@app.route('/notes', methods=['GET'])
@token_required
def list_notes():
    """List all notes for the authenticated user."""
    try:
        user_id = g.current_user_id
        
        db = get_db()
        notes = db.execute(
            'SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
            (user_id,)
        ).fetchall()
        
        result = []
        for note in notes:
            result.append({
                'id': note['id'],
                'title': note['title'],
                'content': note['content']
            })
        
        return jsonify(result), 200
    except Exception:
        # CWE-703: Handle database errors
        return jsonify({'error': 'Server error'}), 500

@app.route('/notes/<int:id>', methods=['GET'])
@token_required
def get_note(id):
    """Get a specific note if the user owns it."""
    try:
        user_id = g.current_user_id
        
        db = get_db()
        note = db.execute(
            'SELECT id, title, content, user_id FROM notes WHERE id = ?',
            (id,)
        ).fetchone()
        
        if not note:
            return jsonify({'error': 'Note not found'}), 404
        
        # CWE-639: Authorization check - ensure user owns the note
        if note['user_id'] != user_id:
            return jsonify({'error': 'Forbidden'}), 403
        
        return jsonify({
            'id': note['id'],
            'title': note['title'],
            'content': note['content']
        }), 200
    except ValueError:
        # Handle invalid ID format
        return jsonify({'error': 'Not found'}), 404
    except Exception:
        # CWE-703: Handle unexpected errors
        return jsonify({'error': 'Server error'}), 500

@app.route('/notes/<int:id>', methods=['DELETE'])
@token_required
def delete_note(id):
    """Delete a specific note if the user owns it."""
    try:
        user_id = g.current_user_id
        
        db = get_db()
        # First check if note exists and user owns it
        note = db.execute(
            'SELECT user_id FROM notes WHERE id = ?',
            (id,)
        ).fetchone()
        
        if not note:
            return jsonify({'error': 'Note not found'}), 404
        
        # CWE-639: Authorization check - ensure user owns the note
        if note['user_id'] != user_id:
            return jsonify({'error': 'Forbidden'}), 403
        
        # Delete the note
        db.execute('DELETE FROM notes WHERE id = ?', (id,))
        db.commit()
        
        return jsonify({'message': 'Note deleted'}), 200
    except ValueError:
        # Handle invalid ID format
        return jsonify({'error': 'Not found'}), 404
    except Exception:
        # CWE-703: Handle unexpected errors
        return jsonify({'error': 'Server error'}), 500

# Global error handlers to prevent information disclosure (CWE-209)
@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all unhandled exceptions."""
    # Log the actual error for debugging (in production, use proper logging)
    app.logger.error(f'Unhandled exception: {repr(e)}')
    # Don't expose the actual error to the client
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    # Run the app
    app.run(host='0.0.0.0', port=5000, debug=False)