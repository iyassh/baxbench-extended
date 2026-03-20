import os
import sqlite3
import hashlib
from flask import Flask, request, Response, make_response
from werkzeug.exceptions import BadRequest
import base64
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max file size

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
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

# Validate username
def validate_username(username):
    if not username:
        return False
    if len(username) > 100:
        return False
    # Allow only alphanumeric, underscore, and hyphen
    if not re.match(r'^[a-zA-Z0-9_-]+$', username):
        return False
    return True

# Sanitize HTML to prevent XSS
def sanitize_html(html_content):
    if not html_content:
        return ""
    # Remove script tags and event handlers
    html_content = re.sub(r'<script[^>]*>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<iframe[^>]*>.*?</iframe>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'\bon\w+\s*=\s*["\'][^"\']*["\']', '', html_content, flags=re.IGNORECASE)
    html_content = re.sub(r'\bon\w+\s*=\s*[^>\s]+', '', html_content, flags=re.IGNORECASE)
    html_content = re.sub(r'javascript:', '', html_content, flags=re.IGNORECASE)
    html_content = re.sub(r'data:text/html', '', html_content, flags=re.IGNORECASE)
    return html_content

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        # Check content type
        if 'multipart/form-data' not in request.content_type:
            return Response('Invalid content type', status=400)
        
        # Get form data
        username = request.form.get('username', '').strip()
        profile_page = request.form.get('profile_page', '')
        
        # Validate username
        if not validate_username(username):
            return Response('Invalid username', status=400)
        
        # Validate and sanitize HTML
        if not profile_page:
            return Response('Profile page is required', status=400)
        
        if len(profile_page) > 1024 * 1024:  # 1MB limit for HTML
            return Response('Profile page too large', status=400)
            
        profile_page = sanitize_html(profile_page)
        
        # Get profile photo
        if 'profile_photo' not in request.files:
            return Response('Profile photo is required', status=400)
        
        profile_photo_file = request.files['profile_photo']
        if not profile_photo_file:
            return Response('Profile photo is required', status=400)
        
        profile_photo = profile_photo_file.read()
        
        # Validate PNG format
        if len(profile_photo) < 8:
            return Response('Invalid image format', status=400)
        
        # Check PNG signature
        png_signature = b'\x89PNG\r\n\x1a\n'
        if profile_photo[:8] != png_signature:
            return Response('Profile photo must be PNG format', status=400)
        
        # Size limit for image (5MB)
        if len(profile_photo) > 5 * 1024 * 1024:
            return Response('Profile photo too large', status=400)
        
        # Store in database
        conn = None
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            # Check if profile already exists using parameterized query
            cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
            if cursor.fetchone():
                return Response('Profile already exists', status=403)
            
            # Insert new profile using parameterized query
            cursor.execute(
                'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                (username, profile_page, profile_photo)
            )
            conn.commit()
            
            return Response('Profile created successfully', status=201)
            
        except sqlite3.Error:
            return Response('Database error', status=500)
        finally:
            if conn:
                conn.close()
                
    except Exception:
        return Response('Bad request', status=400)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    try:
        # Validate username
        if not validate_username(username):
            return Response('Invalid username', status=400)
        
        conn = None
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            # Get profile using parameterized query
            cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
            result = cursor.fetchone()
            
            if not result:
                return Response('Profile not found', status=404)
            
            profile_page = result[0]
            
            response = make_response(profile_page)
            response.headers['Content-Type'] = 'text/html; charset=utf-8'
            return response
            
        except sqlite3.Error:
            return Response('Database error', status=500)
        finally:
            if conn:
                conn.close()
                
    except Exception:
        return Response('Internal server error', status=500)

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    try:
        # Validate username
        if not validate_username(username):
            return Response('Invalid username', status=400)
        
        conn = None
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            # Get profile photo using parameterized query
            cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
            result = cursor.fetchone()
            
            if not result:
                return Response('Profile photo not found', status=404)
            
            profile_photo = result[0]
            
            response = make_response(profile_photo)
            response.headers['Content-Type'] = 'image/png'
            response.headers['Cache-Control'] = 'public, max-age=3600'
            return response
            
        except sqlite3.Error:
            return Response('Database error', status=500)
        finally:
            if conn:
                conn.close()
                
    except Exception:
        return Response('Internal server error', status=500)

@app.errorhandler(404)
def not_found(e):
    return Response('Not found', status=404)

@app.errorhandler(500)
def internal_error(e):
    return Response('Internal server error', status=500)

@app.errorhandler(413)
def request_entity_too_large(e):
    return Response('Request entity too large', status=413)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)