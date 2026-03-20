import os
import sqlite3
from flask import Flask, request, Response, jsonify, make_response
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max for uploads

# Database setup
DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables"""
    try:
        conn = sqlite3.connect(DB_NAME)
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
    except sqlite3.Error as e:
        app.logger.error("Failed to initialize database")
        raise

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME)
        conn.row_factory = sqlite3.Row
        yield conn
    except sqlite3.Error:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    # Default CSP - will be overridden for HTML responses
    if 'Content-Security-Policy' not in response.headers:
        response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request"}), 400

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500

@app.route('/add_profile', methods=['POST'])
def add_profile():
    """Add a new user profile"""
    try:
        # Validate request has required fields
        if 'username' not in request.form:
            return jsonify({"error": "Username is required"}), 400
        if 'profile_page' not in request.form:
            return jsonify({"error": "Profile page is required"}), 400
        if 'profile_photo' not in request.files:
            return jsonify({"error": "Profile photo is required"}), 400
        
        username = request.form.get('username', '').strip()
        profile_page = request.form.get('profile_page', '')
        profile_photo_file = request.files.get('profile_photo')
        
        # Validate username
        if not username:
            return jsonify({"error": "Username cannot be empty"}), 400
        if len(username) > 100:
            return jsonify({"error": "Username too long"}), 400
        # Only allow alphanumeric, underscore, and hyphen
        if not all(c.isalnum() or c in '_-' for c in username):
            return jsonify({"error": "Username contains invalid characters"}), 400
        
        # Validate profile page size (1MB limit)
        if len(profile_page) > 1024 * 1024:
            return jsonify({"error": "Profile page too large"}), 400
        
        # Read and validate profile photo
        if not profile_photo_file:
            return jsonify({"error": "Profile photo is required"}), 400
            
        profile_photo_data = profile_photo_file.read()
        
        # Validate PNG format by checking magic bytes
        if len(profile_photo_data) < 8:
            return jsonify({"error": "Invalid image file"}), 400
        if profile_photo_data[:8] != b'\x89PNG\r\n\x1a\n':
            return jsonify({"error": "Profile photo must be PNG format"}), 400
        
        # Limit photo size (5MB)
        if len(profile_photo_data) > 5 * 1024 * 1024:
            return jsonify({"error": "Profile photo too large"}), 400
        
        # Store in database
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                
                # Check if profile already exists
                cursor.execute('SELECT 1 FROM profiles WHERE username = ?', (username,))
                if cursor.fetchone():
                    return jsonify({"error": "Profile already exists"}), 403
                
                # Insert new profile using parameterized query
                cursor.execute(
                    'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                    (username, profile_page, profile_photo_data)
                )
                conn.commit()
        except sqlite3.IntegrityError:
            return jsonify({"error": "Profile already exists"}), 403
        except sqlite3.Error as e:
            app.logger.error("Database error in add_profile")
            return jsonify({"error": "Failed to create profile"}), 500
        
        return jsonify({"message": "Profile created successfully"}), 201
        
    except Exception as e:
        app.logger.error("Unexpected error in add_profile")
        return jsonify({"error": "An error occurred"}), 500

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    """Get user profile HTML"""
    try:
        # Validate username parameter
        if not username:
            return jsonify({"error": "Username is required"}), 400
        if len(username) > 100:
            return jsonify({"error": "Invalid username"}), 400
        # Only allow safe characters
        if not all(c.isalnum() or c in '_-' for c in username):
            return jsonify({"error": "Invalid username"}), 400
        
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                # Use parameterized query to prevent SQL injection
                cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
                row = cursor.fetchone()
                
                if not row:
                    return jsonify({"error": "Profile not found"}), 404
                
                # Return HTML content with strict CSP to mitigate XSS
                response = make_response(row['profile_page'])
                response.mimetype = 'text/html'
                # Very strict CSP - no scripts allowed at all
                response.headers['Content-Security-Policy'] = (
                    "default-src 'none'; "
                    "style-src 'unsafe-inline' 'self'; "
                    "img-src 'self' data:; "
                    "font-src 'self' data:; "
                    "script-src 'none'; "
                    "object-src 'none'; "
                    "base-uri 'none'; "
                    "form-action 'none'"
                )
                return response
        except sqlite3.Error as e:
            app.logger.error("Database error in get_profile")
            return jsonify({"error": "Failed to retrieve profile"}), 500
            
    except Exception as e:
        app.logger.error("Unexpected error in get_profile")
        return jsonify({"error": "An error occurred"}), 500

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    """Get user profile photo"""
    try:
        # Validate username parameter
        if not username:
            return jsonify({"error": "Username is required"}), 400
        if len(username) > 100:
            return jsonify({"error": "Invalid username"}), 400
        # Only allow safe characters
        if not all(c.isalnum() or c in '_-' for c in username):
            return jsonify({"error": "Invalid username"}), 400
        
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                # Use parameterized query to prevent SQL injection
                cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
                row = cursor.fetchone()
                
                if not row:
                    return jsonify({"error": "Profile photo not found"}), 404
                
                # Return PNG image
                response = make_response(row['profile_photo'])
                response.mimetype = 'image/png'
                return response
        except sqlite3.Error as e:
            app.logger.error("Database error in get_profile_photo")
            return jsonify({"error": "Failed to retrieve profile photo"}), 500
            
    except Exception as e:
        app.logger.error("Unexpected error in get_profile_photo")
        return jsonify({"error": "An error occurred"}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)