import sqlite3
import os
import jwt
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.context import CryptContext

app = Flask(__name__)

# Configuration
SECRET_KEY = os.environ.get('APP_SECRET', 'dev-secret-key')
DATABASE = 'db.sqlite3'

# Password hashing context
pwd_context = CryptContext(
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
    pbkdf2_sha256__rounds=20000,
)

def hash_password(password):
    """Hash a password using passlib."""
    return pwd_context.hash(password)

def verify_password(password, password_hash):
    """Verify a password against its hash."""
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        return False

# Database initialization
def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    # Create users table
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
    )''')
    
    # Create notes table
    c.execute('''CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )''')
    
    conn.commit()
    conn.close()

def get_db():
    """Get database connection."""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    """Close database connection."""
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# JWT token management
def generate_token(user_id):
    """Generate a JWT token for the user."""
    payload = {
        'user_id': user_id,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def verify_token(token):
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        return payload.get('user_id')
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

# Authentication decorator
def token_required(f):
    """Decorator to require valid JWT token."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Check for token in Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                parts = auth_header.split(" ")
                if len(parts) == 2 and parts[0].lower() == 'bearer':
                    token = parts[1]
            except Exception:
                pass
        
        if not token:
            return jsonify({'error': 'Missing authorization token'}), 401
        
        user_id = verify_token(token)
        if user_id is None:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        g.user_id = user_id
        return f(*args, **kwargs)
    
    return decorated

# API Routes

@app.route('/register', methods=['POST'])
def register():
    """Register a new user."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Missing email or password'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email.split('@')[-1]:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Validate password strength
        if len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        password_hash = hash_password(password)
        
        db = get_db()
        try:
            db.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)',
                      (email, password_hash))
            db.commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Email already registered'}), 400
    
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/login', methods=['POST'])
def login():
    """Authenticate user and return JWT token."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Missing email or password'}), 400
        
        db = get_db()
        user = db.execute('SELECT id, password_hash FROM users WHERE email = ?', 
                         (email,)).fetchone()
        
        if user is None or not verify_password(password, user['password_hash']):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        token = generate_token(user['id'])
        return jsonify({'token': token}), 200
    
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/notes', methods=['POST'])
@token_required
def create_note():
    """Create a new note for the authenticated user."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        title = data.get('title', '').strip()
        content = data.get('content', '').strip()
        
        if not title or not content:
            return jsonify({'error': 'Missing title or content'}), 400
        
        user_id = g.user_id
        db = get_db()
        
        cursor = db.execute(
            'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
            (user_id, title, content)
        )
        db.commit()
        
        note_id = cursor.lastrowid
        return jsonify({'id': note_id, 'message': 'Note created'}), 201
    
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/notes', methods=['GET'])
@token_required
def list_notes():
    """List all notes for the authenticated user."""
    try:
        user_id = g.user_id
        db = get_db()
        
        notes = db.execute(
            'SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY id',
            (user_id,)
        ).fetchall()
        
        notes_list = [{'id': note['id'], 'title': note['title'], 'content': note['content']} 
                      for note in notes]
        return jsonify(notes_list), 200
    
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(note_id):
    """Get a specific note by ID. Only the owner can access it."""
    try:
        user_id = g.user_id
        db = get_db()
        
        note = db.execute(
            'SELECT id, user_id, title, content FROM notes WHERE id = ?',
            (note_id,)
        ).fetchone()
        
        if note is None:
            return jsonify({'error': 'Note not found'}), 404
        
        # Check ownership (CWE-639 prevention)
        if note['user_id'] != user_id:
            return jsonify({'error': 'Forbidden'}), 403
        
        return jsonify({'id': note['id'], 'title': note['title'], 'content': note['content']}), 200
    
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(note_id):
    """Delete a note by ID. Only the owner can delete it."""
    try:
        user_id = g.user_id
        db = get_db()
        
        note = db.execute(
            'SELECT user_id FROM notes WHERE id = ?',
            (note_id,)
        ).fetchone()
        
        if note is None:
            return jsonify({'error': 'Note not found'}), 404
        
        # Check ownership (CWE-639 prevention)
        if note['user_id'] != user_id:
            return jsonify({'error': 'Forbidden'}), 403
        
        db.execute('DELETE FROM notes WHERE id = ?', (note_id,))
        db.commit()
        
        return jsonify({'message': 'Note deleted'}), 200
    
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({'error': 'Internal server error'}), 500

# Application entry point
if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)