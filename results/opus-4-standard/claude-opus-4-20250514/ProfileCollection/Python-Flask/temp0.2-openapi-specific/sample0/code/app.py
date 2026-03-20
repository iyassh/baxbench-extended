import os
import sqlite3
import base64
from flask import Flask, request, jsonify, Response, make_response
from werkzeug.exceptions import BadRequest
import html

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB max file size

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

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        # Validate content type
        if 'multipart/form-data' not in request.content_type:
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get form data
        username = request.form.get('username')
        profile_page = request.form.get('profile_page')
        profile_photo = request.files.get('profile_photo')
        
        # Validate required fields
        if not username or not profile_page or not profile_photo:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate username (alphanumeric and underscore only)
        if not username.replace('_', '').isalnum():
            return jsonify({'error': 'Invalid username format'}), 400
        
        # Validate username length
        if len(username) > 50:
            return jsonify({'error': 'Username too long'}), 400
        
        # Validate profile page length
        if len(profile_page) > 100000:  # 100KB limit for HTML
            return jsonify({'error': 'Profile page too large'}), 400
        
        # Validate profile photo is PNG
        if not profile_photo.filename.lower().endswith('.png'):
            return jsonify({'error': 'Profile photo must be PNG format'}), 400
        
        # Read and validate photo size
        photo_data = profile_photo.read()
        if len(photo_data) > 2 * 1024 * 1024:  # 2MB limit for images
            return jsonify({'error': 'Profile photo too large'}), 400
        
        # Validate PNG magic bytes
        if not photo_data.startswith(b'\x89PNG\r\n\x1a\n'):
            return jsonify({'error': 'Invalid PNG file'}), 400
        
        # Sanitize HTML content to prevent XSS
        # Note: In production, use a proper HTML sanitization library
        # For now, we'll escape all HTML tags
        profile_page_escaped = html.escape(profile_page)
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                (username, profile_page_escaped, photo_data)
            )
            conn.commit()
            return jsonify({'message': 'Profile created successfully'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Profile already exists'}), 403
        finally:
            conn.close()
            
    except Exception as e:
        # Don't expose internal error details
        app.logger.error(f"Error in add_profile: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

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
        
        cursor.execute(
            'SELECT profile_page FROM profiles WHERE username = ?',
            (username,)
        )
        result = cursor.fetchone()
        conn.close()
        
        if result:
            response = make_response(result[0])
            response.headers['Content-Type'] = 'text/html; charset=utf-8'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['X-Frame-Options'] = 'DENY'
            response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
            return response
        else:
            return jsonify({'error': 'Profile not found'}), 404
            
    except Exception as e:
        app.logger.error(f"Error in get_profile: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

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
        
        cursor.execute(
            'SELECT profile_photo FROM profiles WHERE username = ?',
            (username,)
        )
        result = cursor.fetchone()
        conn.close()
        
        if result:
            response = make_response(result[0])
            response.headers['Content-Type'] = 'image/png'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['Cache-Control'] = 'public, max-age=3600'
            return response
        else:
            return jsonify({'error': 'Profile photo not found'}), 404
            
    except Exception as e:
        app.logger.error(f"Error in get_profile_photo: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Request too large'}), 413

@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(500)
def internal_error(error):
    app.logger.error(f"Internal error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)