import os
import sqlite3
import hashlib
from flask import Flask, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename
from werkzeug.exceptions import BadRequest, NotFound, Forbidden
import io
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
    return response

def init_db():
    """Initialize the SQLite database with proper schema"""
    try:
        conn = sqlite3.connect('db.sqlite3')
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
    except Exception as e:
        app.logger.error("Database initialization failed")
        raise

def validate_username(username):
    """Validate username format and length"""
    if not username or len(username) < 1 or len(username) > 50:
        return False
    # Allow only alphanumeric characters, underscores, and hyphens
    if not re.match(r'^[a-zA-Z0-9_-]+$', username):
        return False
    return True

def validate_html_content(html_content):
    """Basic validation for HTML content"""
    if not html_content or len(html_content) > 1024 * 1024:  # 1MB limit
        return False
    # Basic check for potentially dangerous content
    dangerous_patterns = [
        r'<script[^>]*>',
        r'javascript:',
        r'on\w+\s*=',
        r'<iframe[^>]*>',
        r'<object[^>]*>',
        r'<embed[^>]*>'
    ]
    for pattern in dangerous_patterns:
        if re.search(pattern, html_content, re.IGNORECASE):
            return False
    return True

def validate_png_image(image_data):
    """Validate PNG image format and size"""
    if not image_data or len(image_data) > 5 * 1024 * 1024:  # 5MB limit
        return False
    # Check PNG signature
    png_signature = b'\x89PNG\r\n\x1a\n'
    if not image_data.startswith(png_signature):
        return False
    return True

@app.route('/add_profile', methods=['POST'])
def add_profile():
    """Add a new user profile"""
    try:
        # Validate content type
        if not request.content_type or not request.content_type.startswith('multipart/form-data'):
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Extract form data
        username = request.form.get('username', '').strip()
        profile_page = request.form.get('profile_page', '').strip()
        
        # Get profile photo from files
        if 'profile_photo' not in request.files:
            return jsonify({'error': 'Profile photo is required'}), 400
        
        profile_photo_file = request.files['profile_photo']
        if profile_photo_file.filename == '':
            return jsonify({'error': 'No profile photo selected'}), 400
        
        profile_photo_data = profile_photo_file.read()
        
        # Validate inputs
        if not validate_username(username):
            return jsonify({'error': 'Invalid username format'}), 400
        
        if not validate_html_content(profile_page):
            return jsonify({'error': 'Invalid HTML content'}), 400
        
        if not validate_png_image(profile_photo_data):
            return jsonify({'error': 'Invalid PNG image'}), 400
        
        # Database operations
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            # Check if profile already exists
            cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
            if cursor.fetchone():
                conn.close()
                return jsonify({'error': 'Profile already exists'}), 403
            
            # Insert new profile
            cursor.execute('''
                INSERT INTO profiles (username, profile_page, profile_photo)
                VALUES (?, ?, ?)
            ''', (username, profile_page, profile_photo_data))
            
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Profile created successfully'}), 201
            
        except sqlite3.Error as e:
            app.logger.error("Database error occurred")
            return jsonify({'error': 'Database error'}), 500
        
    except BadRequest:
        return jsonify({'error': 'Invalid request format'}), 400
    except Exception as e:
        app.logger.error("Unexpected error in add_profile")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    """Get user profile HTML content"""
    try:
        # Validate username
        if not validate_username(username):
            return jsonify({'error': 'Invalid username format'}), 400
        
        # Database operations
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
            result = cursor.fetchone()
            conn.close()
            
            if not result:
                abort(404)
            
            # Return HTML content with proper content type
            return result[0], 200, {'Content-Type': 'text/html; charset=utf-8'}
            
        except sqlite3.Error as e:
            app.logger.error("Database error occurred")
            return jsonify({'error': 'Database error'}), 500
        
    except Exception as e:
        app.logger.error("Unexpected error in get_profile")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    """Get user profile photo"""
    try:
        # Validate username
        if not validate_username(username):
            return jsonify({'error': 'Invalid username format'}), 400
        
        # Database operations
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
            result = cursor.fetchone()
            conn.close()
            
            if not result:
                abort(404)
            
            # Return PNG image
            photo_data = result[0]
            return send_file(
                io.BytesIO(photo_data),
                mimetype='image/png',
                as_attachment=False
            )
            
        except sqlite3.Error as e:
            app.logger.error("Database error occurred")
            return jsonify({'error': 'Database error'}), 500
        
    except Exception as e:
        app.logger.error("Unexpected error in get_profile_photo")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(403)
def forbidden(error):
    return jsonify({'error': 'Forbidden'}), 403

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'File too large'}), 413

@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    try:
        init_db()
        app.run(host='0.0.0.0', port=5000, debug=False)
    except Exception as e:
        print("Failed to start application")
        exit(1)