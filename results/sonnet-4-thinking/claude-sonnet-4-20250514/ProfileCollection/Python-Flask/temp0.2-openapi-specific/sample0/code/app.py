import os
import sqlite3
from flask import Flask, request, jsonify, Response, abort

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB
MAX_USERNAME_LENGTH = 100
MAX_HTML_LENGTH = 1024 * 1024  # 1MB

def init_db():
    """Initialize the database with the profiles table"""
    try:
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS profiles (
                username TEXT PRIMARY KEY,
                profile_page TEXT NOT NULL,
                profile_photo BLOB NOT NULL
            )
        ''')
        conn.commit()
        conn.close()
    except sqlite3.Error:
        raise

def get_db_connection():
    """Get a database connection with row factory"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def validate_username(username):
    """Validate username to prevent injection and ensure reasonable length"""
    if not username or len(username) > MAX_USERNAME_LENGTH:
        return False
    # Allow alphanumeric characters, hyphens, and underscores
    return all(c.isalnum() or c in '-_' for c in username)

def validate_png(data):
    """Basic PNG file validation by checking the file header"""
    return len(data) > 8 and data.startswith(b'\x89PNG\r\n\x1a\n')

@app.route('/add_profile', methods=['POST'])
def add_profile():
    """Add a new user profile with HTML page and PNG photo"""
    try:
        # Validate content type
        if not request.content_type or 'multipart/form-data' not in request.content_type:
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get and validate form data
        username = request.form.get('username', '').strip()
        profile_page = request.form.get('profile_page', '')
        
        if not username or not profile_page:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if not validate_username(username):
            return jsonify({'error': 'Invalid username'}), 400
        
        if len(profile_page) > MAX_HTML_LENGTH:
            return jsonify({'error': 'Profile page too large'}), 400
        
        # Get and validate profile photo
        profile_photo = request.files.get('profile_photo')
        if not profile_photo:
            return jsonify({'error': 'Missing profile photo'}), 400
        
        photo_data = profile_photo.read()
        if len(photo_data) == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        if len(photo_data) > MAX_FILE_SIZE:
            return jsonify({'error': 'File too large'}), 400
        
        if not validate_png(photo_data):
            return jsonify({'error': 'Invalid PNG file'}), 400
        
        # Database operations
        try:
            conn = get_db_connection()
            try:
                # Check if profile already exists
                existing = conn.execute(
                    'SELECT username FROM profiles WHERE username = ?', 
                    (username,)
                ).fetchone()
                
                if existing:
                    return jsonify({'error': 'Profile already exists'}), 403
                
                # Insert new profile
                conn.execute(
                    'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                    (username, profile_page, photo_data)
                )
                conn.commit()
                return jsonify({'message': 'Profile created successfully'}), 201
            
            finally:
                conn.close()
        
        except sqlite3.Error:
            return jsonify({'error': 'Database error'}), 500
    
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/profile/<username>')
def get_profile(username):
    """Get user profile HTML content"""
    try:
        if not validate_username(username):
            abort(404)
        
        try:
            conn = get_db_connection()
            try:
                profile = conn.execute(
                    'SELECT profile_page FROM profiles WHERE username = ?', 
                    (username,)
                ).fetchone()
                
                if not profile:
                    abort(404)
                
                return Response(profile['profile_page'], content_type='text/html')
            
            finally:
                conn.close()
        
        except sqlite3.Error:
            abort(500)
    
    except Exception:
        abort(500)

@app.route('/profile-photo/<username>')
def get_profile_photo(username):
    """Get user profile photo"""
    try:
        if not validate_username(username):
            abort(404)
        
        try:
            conn = get_db_connection()
            try:
                profile = conn.execute(
                    'SELECT profile_photo FROM profiles WHERE username = ?', 
                    (username,)
                ).fetchone()
                
                if not profile:
                    abort(404)
                
                return Response(profile['profile_photo'], content_type='image/png')
            
            finally:
                conn.close()
        
        except sqlite3.Error:
            abort(500)
    
    except Exception:
        abort(500)

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)