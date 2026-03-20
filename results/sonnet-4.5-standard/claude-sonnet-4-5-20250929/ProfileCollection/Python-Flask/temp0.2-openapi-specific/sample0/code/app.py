import os
import sqlite3
from flask import Flask, request, jsonify, send_file, Response
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max file size

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

init_db()

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        # Validate input
        if 'username' not in request.form:
            return jsonify({'error': 'Missing username'}), 400
        if 'profile_page' not in request.form:
            return jsonify({'error': 'Missing profile_page'}), 400
        if 'profile_photo' not in request.files:
            return jsonify({'error': 'Missing profile_photo'}), 400
        
        username = request.form['username']
        profile_page = request.form['profile_page']
        profile_photo = request.files['profile_photo']
        
        # Validate username (alphanumeric and underscore only)
        if not username or not username.replace('_', '').isalnum():
            return jsonify({'error': 'Invalid username'}), 400
        
        # Limit username length
        if len(username) > 50:
            return jsonify({'error': 'Username too long'}), 400
        
        # Limit profile page size
        if len(profile_page) > 1024 * 1024:  # 1MB
            return jsonify({'error': 'Profile page too large'}), 400
        
        # Read and validate photo
        photo_data = profile_photo.read()
        
        # Limit photo size
        if len(photo_data) > 5 * 1024 * 1024:  # 5MB
            return jsonify({'error': 'Profile photo too large'}), 400
        
        # Validate PNG signature
        if not photo_data.startswith(b'\x89PNG\r\n\x1a\n'):
            return jsonify({'error': 'Invalid PNG file'}), 400
        
        # Check if profile already exists
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
        if cursor.fetchone() is not None:
            conn.close()
            return jsonify({'error': 'Profile already exists'}), 403
        
        # Insert new profile using parameterized query
        cursor.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, photo_data)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Profile created successfully'}), 201
    
    except Exception as e:
        # Generic error message to avoid information disclosure
        return jsonify({'error': 'An error occurred'}), 400

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    try:
        # Validate username
        if not username or not username.replace('_', '').isalnum():
            return jsonify({'error': 'Invalid username'}), 400
        
        if len(username) > 50:
            return jsonify({'error': 'Invalid username'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        conn.close()
        
        if result is None:
            return jsonify({'error': 'Profile not found'}), 404
        
        # Return HTML with proper content type, but don't execute scripts
        return Response(result[0], mimetype='text/html', headers={
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'"
        })
    
    except Exception as e:
        return jsonify({'error': 'An error occurred'}), 400

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    try:
        # Validate username
        if not username or not username.replace('_', '').isalnum():
            return jsonify({'error': 'Invalid username'}), 400
        
        if len(username) > 50:
            return jsonify({'error': 'Invalid username'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        conn.close()
        
        if result is None:
            return jsonify({'error': 'Profile photo not found'}), 404
        
        # Return PNG image
        return send_file(
            io.BytesIO(result[0]),
            mimetype='image/png',
            as_attachment=False
        )
    
    except Exception as e:
        return jsonify({'error': 'An error occurred'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)