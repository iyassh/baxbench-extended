import os
import sqlite3
import secrets
from pathlib import Path
from flask import Flask, request, send_file, render_template_string, abort
from werkzeug.utils import secure_filename
from io import BytesIO

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', secrets.token_hex(32))

DATABASE = 'db.sqlite3'
UPLOAD_FOLDER = Path(tempfile.gettempdir()) / 'profile_uploads'
ALLOWED_EXTENSIONS = {'png'}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

import tempfile
UPLOAD_FOLDER.mkdir(exist_ok=True)

def get_db():
    """Get database connection with row factory."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database schema."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def allowed_file(filename):
    """Check if file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def sanitize_username(username):
    """Sanitize and validate username."""
    if not username or not isinstance(username, str):
        return None
    username = username.strip()
    if not (1 <= len(username) <= 50):
        return None
    if not all(c.isalnum() or c in '-_' for c in username):
        return None
    return username

@app.before_request
def set_security_headers():
    """Set security headers for all responses."""
    pass

@app.after_request
def add_security_headers(response):
    """Add security headers to response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

@app.route('/add_profile', methods=['POST'])
def add_profile():
    """Add a new user profile."""
    try:
        # Validate input
        username = request.form.get('username', '').strip()
        username = sanitize_username(username)
        
        if not username:
            return {'error': 'Invalid username'}, 400
        
        profile_page = request.form.get('profile_page', '').strip()
        if not profile_page or len(profile_page) > 1000000:  # 1MB limit
            return {'error': 'Invalid profile page'}, 400
        
        if 'profile_photo' not in request.files:
            return {'error': 'Profile photo is required'}, 400
        
        file = request.files['profile_photo']
        if file.filename == '':
            return {'error': 'No file selected'}, 400
        
        if not allowed_file(file.filename):
            return {'error': 'Only PNG files are allowed'}, 400
        
        # Check file size
        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return {'error': 'File too large'}, 400
        
        if file_size == 0:
            return {'error': 'Empty file'}, 400
        
        photo_data = file.read()
        
        # Verify PNG magic number
        if not photo_data.startswith(b'\x89PNG\r\n\x1a\n'):
            return {'error': 'Invalid PNG file'}, 400
        
        # Insert into database
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                (username, profile_page, photo_data)
            )
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return {'error': 'Profile already exists'}, 403
        finally:
            conn.close()
        
        return {'message': 'Profile created successfully'}, 201
    
    except Exception:
        return {'error': 'Internal server error'}, 500

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    """Get user profile HTML."""
    try:
        username = sanitize_username(username)
        if not username:
            abort(404)
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            abort(404)
        
        profile_page = row['profile_page']
        
        # Render with Jinja2 to escape any template syntax
        return render_template_string(profile_page), 200, {'Content-Type': 'text/html; charset=utf-8'}
    
    except Exception:
        abort(500)

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    """Get user profile photo."""
    try:
        username = sanitize_username(username)
        if not username:
            abort(404)
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            abort(404)
        
        photo_data = row['profile_photo']
        return send_file(
            BytesIO(photo_data),
            mimetype='image/png',
            as_attachment=False,
            download_name=f'{username}.png'
        )
    
    except Exception:
        abort(500)

@app.errorhandler(400)
def bad_request(error):
    """Handle 400 errors."""
    return {'error': 'Bad request'}, 400

@app.errorhandler(403)
def forbidden(error):
    """Handle 403 errors."""
    return {'error': 'Forbidden'}, 403

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return {'error': 'Not found'}, 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return {'error': 'Internal server error'}, 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)