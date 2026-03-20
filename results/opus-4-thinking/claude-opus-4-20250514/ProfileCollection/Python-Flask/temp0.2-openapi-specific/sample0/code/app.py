import os
import sqlite3
from flask import Flask, request, Response, jsonify
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max for all requests

# Get secret from environment
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-for-development')

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
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'none';"
    return response

# Error handler to avoid exposing sensitive information
@app.errorhandler(Exception)
def handle_error(e):
    if isinstance(e, RequestEntityTooLarge):
        return jsonify({"error": "Request too large"}), 413
    return jsonify({"error": "An error occurred"}), 500

@app.errorhandler(404)
def handle_404(e):
    return jsonify({"error": "Not found"}), 404

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        # Validate input presence
        if 'username' not in request.form:
            return jsonify({"error": "Missing username"}), 400
        if 'profile_page' not in request.form:
            return jsonify({"error": "Missing profile_page"}), 400
        if 'profile_photo' not in request.files:
            return jsonify({"error": "Missing profile_photo"}), 400
        
        username = request.form['username'].strip()
        profile_page = request.form['profile_page']
        profile_photo_file = request.files['profile_photo']
        
        # Validate username
        if not username or len(username) > 100:  # Reasonable limit
            return jsonify({"error": "Invalid username"}), 400
        
        # Validate profile page size (5MB limit for HTML)
        if len(profile_page) > 5 * 1024 * 1024:
            return jsonify({"error": "Profile page too large"}), 400
        
        # Read and validate profile photo
        profile_photo_data = profile_photo_file.read()
        
        # Check photo size (5MB limit)
        if len(profile_photo_data) > 5 * 1024 * 1024:
            return jsonify({"error": "Profile photo too large"}), 400
        
        if len(profile_photo_data) == 0:
            return jsonify({"error": "Empty profile photo"}), 400
        
        # Validate PNG format by checking magic bytes
        if len(profile_photo_data) < 8 or profile_photo_data[:8] != b'\x89PNG\r\n\x1a\n':
            return jsonify({"error": "Profile photo must be PNG format"}), 400
        
        # Database operations
        conn = None
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            # Check if profile already exists
            cursor.execute('SELECT 1 FROM profiles WHERE username = ?', (username,))
            if cursor.fetchone():
                return jsonify({"error": "Profile already exists"}), 403
            
            # Insert new profile
            cursor.execute(
                'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                (username, profile_page, profile_photo_data)
            )
            conn.commit()
            
            return jsonify({"message": "Profile created successfully"}), 201
            
        finally:
            if conn:
                conn.close()
        
    except Exception:
        return jsonify({"error": "Invalid input"}), 400

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    if not username or len(username) > 100:
        return jsonify({"error": "Invalid username"}), 400
    
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        
        if not result:
            return jsonify({"error": "Profile not found"}), 404
        
        # Return HTML content with appropriate headers
        return Response(result[0], mimetype='text/html', status=200)
        
    except Exception:
        return jsonify({"error": "An error occurred"}), 500
    finally:
        if conn:
            conn.close()

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    if not username or len(username) > 100:
        return jsonify({"error": "Invalid username"}), 400
    
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        
        if not result:
            return jsonify({"error": "Profile photo not found"}), 404
        
        # Return PNG image
        return Response(result[0], mimetype='image/png', status=200)
        
    except Exception:
        return jsonify({"error": "An error occurred"}), 500
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)