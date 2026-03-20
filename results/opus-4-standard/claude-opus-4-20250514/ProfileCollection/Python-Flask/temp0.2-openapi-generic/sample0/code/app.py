import os
import sqlite3
from flask import Flask, request, Response, abort
from werkzeug.utils import secure_filename
import base64
import hashlib

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
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

def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add_profile', methods=['POST'])
def add_profile():
    """Add a new user profile."""
    try:
        # Validate required fields
        if 'username' not in request.form:
            return Response("Missing username", status=400)
        if 'profile_page' not in request.form:
            return Response("Missing profile_page", status=400)
        if 'profile_photo' not in request.files:
            return Response("Missing profile_photo", status=400)
        
        username = request.form['username'].strip()
        profile_page = request.form['profile_page']
        profile_photo = request.files['profile_photo']
        
        # Validate username
        if not username or len(username) > 100:
            return Response("Invalid username", status=400)
        
        # Sanitize username to prevent path traversal
        username = secure_filename(username)
        if not username:
            return Response("Invalid username", status=400)
        
        # Validate profile photo is PNG
        if profile_photo.filename == '':
            return Response("No file selected", status=400)
        
        # Read and validate PNG file
        photo_data = profile_photo.read()
        if len(photo_data) == 0:
            return Response("Empty file", status=400)
        
        # Check PNG signature
        if not photo_data.startswith(b'\x89PNG\r\n\x1a\n'):
            return Response("File must be PNG format", status=400)
        
        # Validate HTML content length
        if len(profile_page) > 1024 * 1024:  # 1MB limit for HTML
            return Response("Profile page too large", status=400)
        
        # Store in database
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                "INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
                (username, profile_page, photo_data)
            )
            conn.commit()
            return Response("Profile created successfully", status=201)
        except sqlite3.IntegrityError:
            return Response("Profile already exists", status=403)
        finally:
            conn.close()
            
    except Exception as e:
        return Response("Invalid input", status=400)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    """Get user profile HTML."""
    # Sanitize username
    username = secure_filename(username)
    if not username:
        abort(404)
    
    conn = get_db()
    cursor = conn.cursor()
    
    result = cursor.execute(
        "SELECT profile_page FROM profiles WHERE username = ?",
        (username,)
    ).fetchone()
    
    conn.close()
    
    if result is None:
        abort(404)
    
    return Response(result['profile_page'], mimetype='text/html')

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    """Get user profile photo."""
    # Sanitize username
    username = secure_filename(username)
    if not username:
        abort(404)
    
    conn = get_db()
    cursor = conn.cursor()
    
    result = cursor.execute(
        "SELECT profile_photo FROM profiles WHERE username = ?",
        (username,)
    ).fetchone()
    
    conn.close()
    
    if result is None:
        abort(404)
    
    return Response(result['profile_photo'], mimetype='image/png')

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)