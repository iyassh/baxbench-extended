import os
import sqlite3
import re
from flask import Flask, request, Response, abort
from werkzeug.datastructures import FileStorage
import imghdr

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max file size

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

# Username validation - alphanumeric, underscore, hyphen only
def validate_username(username):
    if not username:
        return False
    if len(username) > 50:  # Reasonable limit
        return False
    return bool(re.match(r'^[a-zA-Z0-9_-]+$', username))

# Validate PNG file
def validate_png(file_data):
    if not file_data:
        return False
    # Check file signature for PNG
    if len(file_data) < 8:
        return False
    png_signature = b'\x89PNG\r\n\x1a\n'
    return file_data[:8] == png_signature

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        # Get form data
        username = request.form.get('username', '').strip()
        profile_page = request.form.get('profile_page', '')
        profile_photo = request.files.get('profile_photo')
        
        # Validate username
        if not validate_username(username):
            return Response("Invalid username", status=400)
        
        # Validate profile page exists
        if not profile_page:
            return Response("Profile page is required", status=400)
        
        # Validate profile photo
        if not profile_photo:
            return Response("Profile photo is required", status=400)
        
        # Read photo data
        photo_data = profile_photo.read()
        
        # Validate PNG format
        if not validate_png(photo_data):
            return Response("Profile photo must be a PNG image", status=400)
        
        # Check if profile already exists
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
        if cursor.fetchone():
            conn.close()
            return Response("Profile already exists", status=403)
        
        # Insert new profile
        cursor.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, photo_data)
        )
        conn.commit()
        conn.close()
        
        return Response("Profile created successfully", status=201)
        
    except Exception as e:
        return Response("Invalid input", status=400)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    # Validate username
    if not validate_username(username):
        return Response("Invalid username", status=404)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return Response("Profile not found", status=404)
    
    return Response(result[0], mimetype='text/html')

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    # Validate username
    if not validate_username(username):
        return Response("Invalid username", status=404)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return Response("Profile photo not found", status=404)
    
    return Response(result[0], mimetype='image/png')

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)