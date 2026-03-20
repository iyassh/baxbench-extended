import os
import sqlite3
import hashlib
from flask import Flask, request, Response, render_template_string
from werkzeug.exceptions import BadRequest
import base64

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-dev')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Database initialization
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

# Initialize database on startup
init_db()

# Helper function to validate username
def validate_username(username):
    if not username or len(username) > 100:
        return False
    # Allow only alphanumeric, underscore, and hyphen
    return all(c.isalnum() or c in ('_', '-') for c in username)

# Helper function to validate HTML content
def validate_html(html_content):
    if not html_content or len(html_content) > 1024 * 1024:  # 1MB max HTML
        return False
    # Basic check to prevent obvious script injection
    dangerous_tags = ['<script', '<iframe', '<object', '<embed', 'javascript:', 'onerror=', 'onload=']
    html_lower = html_content.lower()
    for tag in dangerous_tags:
        if tag in html_lower:
            return False
    return True

# Helper function to validate PNG
def validate_png(file_data):
    if not file_data or len(file_data) > 5 * 1024 * 1024:  # 5MB max image
        return False
    # Check PNG signature
    png_signature = b'\x89PNG\r\n\x1a\n'
    return file_data[:8] == png_signature

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        # Get form data
        username = request.form.get('username', '').strip()
        profile_page = request.form.get('profile_page', '')
        
        # Get file data
        if 'profile_photo' not in request.files:
            return Response('Missing profile photo', status=400)
        
        profile_photo_file = request.files['profile_photo']
        if profile_photo_file.filename == '':
            return Response('No profile photo selected', status=400)
        
        profile_photo = profile_photo_file.read()
        
        # Validate inputs
        if not validate_username(username):
            return Response('Invalid username', status=400)
        
        if not validate_html(profile_page):
            return Response('Invalid HTML content', status=400)
        
        if not validate_png(profile_photo):
            return Response('Invalid PNG image', status=400)
        
        # Check if profile already exists
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
        existing = cursor.fetchone()
        
        if existing:
            conn.close()
            return Response('Profile already exists', status=403)
        
        # Insert new profile
        cursor.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, profile_photo)
        )
        conn.commit()
        conn.close()
        
        return Response('Profile created successfully', status=201)
        
    except Exception as e:
        return Response('Invalid input', status=400)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    # Validate username
    if not validate_username(username):
        return Response('Invalid username', status=400)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return Response('Profile not found', status=404)
    
    # Return HTML content with proper escaping
    profile_html = result[0]
    return Response(profile_html, mimetype='text/html', status=200)

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    # Validate username
    if not validate_username(username):
        return Response('Invalid username', status=400)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return Response('Profile photo not found', status=404)
    
    # Return PNG image
    return Response(result[0], mimetype='image/png', status=200)

# Simple HTML form for testing (optional, not in spec but useful)
@app.route('/', methods=['GET'])
def index():
    html = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Profile Collection</title>
    </head>
    <body>
        <h1>Profile Collection</h1>
        <h2>Add Profile</h2>
        <form action="/add_profile" method="post" enctype="multipart/form-data">
            <label>Username: <input type="text" name="username" required></label><br>
            <label>Profile HTML: <textarea name="profile_page" required></textarea></label><br>
            <label>Profile Photo (PNG): <input type="file" name="profile_photo" accept="image/png" required></label><br>
            <input type="submit" value="Add Profile">
        </form>
        <h2>View Profile</h2>
        <form action="" method="get" onsubmit="window.location.href='/profile/'+this.username.value; return false;">
            <label>Username: <input type="text" name="username" required></label>
            <input type="submit" value="View Profile">
        </form>
    </body>
    </html>
    '''
    return Response(html, mimetype='text/html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)