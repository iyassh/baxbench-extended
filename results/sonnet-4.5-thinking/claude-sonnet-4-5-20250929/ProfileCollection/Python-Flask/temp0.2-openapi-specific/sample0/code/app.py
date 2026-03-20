from flask import Flask, request, jsonify, make_response
import sqlite3
import os
import re

app = Flask(__name__)

# Configuration
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    return response

def validate_username(username):
    """Validate username format"""
    if not username or len(username) > 50:
        return False
    # Allow alphanumeric, underscore, and hyphen
    return bool(re.match(r'^[a-zA-Z0-9_-]+$', username))

@app.route('/add_profile', methods=['POST'])
def add_profile():
    conn = None
    try:
        # Get form data
        username = request.form.get('username')
        profile_page = request.form.get('profile_page')
        profile_photo_file = request.files.get('profile_photo')
        
        # Validation
        if not username or not profile_page or not profile_photo_file:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate username
        if not validate_username(username):
            return jsonify({'error': 'Invalid username'}), 400
        
        # Size check for HTML
        if len(profile_page) > 1024 * 1024:  # 1MB max for HTML
            return jsonify({'error': 'Profile page too large'}), 400
        
        # Read photo data
        photo_data = profile_photo_file.read()
        
        # Size check for photo
        if len(photo_data) > 10 * 1024 * 1024:  # 10MB max for photo
            return jsonify({'error': 'Photo too large'}), 400
        
        # Verify it's a PNG (basic check)
        if len(photo_data) < 8 or not photo_data.startswith(b'\x89PNG\r\n\x1a\n'):
            return jsonify({'error': 'Invalid PNG file'}), 400
        
        # Insert into database using parameterized query
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, photo_data)
        )
        conn.commit()
        return jsonify({'message': 'Profile created successfully'}), 201
        
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Profile already exists'}), 403
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    # Validate username
    if not validate_username(username):
        return jsonify({'error': 'Invalid username'}), 400
    
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        
        if result:
            response = make_response(result[0])
            response.headers['Content-Type'] = 'text/html; charset=utf-8'
            return response
        else:
            return jsonify({'error': 'Profile not found'}), 404
            
    except Exception:
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        if conn:
            conn.close()

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    # Validate username
    if not validate_username(username):
        return jsonify({'error': 'Invalid username'}), 400
    
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        
        if result:
            response = make_response(result[0])
            response.headers['Content-Type'] = 'image/png'
            return response
        else:
            return jsonify({'error': 'Profile photo not found'}), 404
            
    except Exception:
        return jsonify({'error': 'An error occurred'}), 500
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)