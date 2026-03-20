import os
import sqlite3
import logging
from flask import Flask, request, jsonify, g, Response, after_this_request

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB max upload size

DATABASE = 'db.sqlite3'

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                profile_page BLOB NOT NULL,
                profile_photo BLOB NOT NULL
            )
        ''')
        db.commit()

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        username = request.form.get('username', '').strip()
        profile_page = request.form.get('profile_page', '')
        profile_photo = request.files.get('profile_photo')

        # Validate inputs
        if not username:
            return Response('Invalid input: username is required', status=400)
        
        if len(username) > 64:
            return Response('Invalid input: username too long', status=400)
        
        # Validate username characters to prevent path traversal and injection
        import re
        if not re.match(r'^[a-zA-Z0-9_\-\.]+$', username):
            return Response('Invalid input: username contains invalid characters', status=400)

        if not profile_page:
            return Response('Invalid input: profile_page is required', status=400)
        
        if len(profile_page) > 1 * 1024 * 1024:  # 1MB limit for HTML
            return Response('Invalid input: profile_page too large', status=400)

        if profile_photo is None:
            return Response('Invalid input: profile_photo is required', status=400)

        # Validate that the photo is a PNG
        photo_data = profile_photo.read(8)
        PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
        if len(photo_data) < 8 or photo_data[:8] != PNG_SIGNATURE:
            return Response('Invalid input: profile_photo must be a valid PNG', status=400)
        
        # Read the rest of the photo
        rest_of_photo = profile_photo.read(5 * 1024 * 1024)
        full_photo = photo_data + rest_of_photo
        
        if len(full_photo) > 5 * 1024 * 1024:
            return Response('Invalid input: profile_photo too large', status=400)

        db = get_db()
        
        # Check if profile already exists
        existing = db.execute(
            'SELECT id FROM profiles WHERE username = ?', (username,)
        ).fetchone()
        
        if existing:
            return Response('Profile already exists', status=403)

        # Store profile_page as text (HTML content)
        db.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, sqlite3.Binary(full_photo))
        )
        db.commit()
        
        return Response('Profile created successfully', status=201)

    except sqlite3.Error as e:
        logger.error('Database error in add_profile: %s', str(e))
        return Response('An error occurred while creating the profile', status=500)
    except Exception as e:
        logger.error('Unexpected error in add_profile: %s', str(e))
        return Response('An unexpected error occurred', status=500)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    try:
        # Validate username
        import re
        if not re.match(r'^[a-zA-Z0-9_\-\.]+$', username):
            return Response('Profile not found', status=404)
        
        db = get_db()
        row = db.execute(
            'SELECT profile_page FROM profiles WHERE username = ?', (username,)
        ).fetchone()
        
        if row is None:
            return Response('Profile not found', status=404)
        
        # Return the HTML content - note: this is user-provided HTML
        # We serve it with text/html but with strict CSP to mitigate XSS
        response = Response(row['profile_page'], status=200, mimetype='text/html')
        return response

    except sqlite3.Error as e:
        logger.error('Database error in get_profile: %s', str(e))
        return Response('An error occurred while retrieving the profile', status=500)
    except Exception as e:
        logger.error('Unexpected error in get_profile: %s', str(e))
        return Response('An unexpected error occurred', status=500)

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    try:
        # Validate username
        import re
        if not re.match(r'^[a-zA-Z0-9_\-\.]+$', username):
            return Response('Profile photo not found', status=404)
        
        db = get_db()
        row = db.execute(
            'SELECT profile_photo FROM profiles WHERE username = ?', (username,)
        ).fetchone()
        
        if row is None:
            return Response('Profile photo not found', status=404)
        
        response = Response(bytes(row['profile_photo']), status=200, mimetype='image/png')
        return response

    except sqlite3.Error as e:
        logger.error('Database error in get_profile_photo: %s', str(e))
        return Response('An error occurred while retrieving the profile photo', status=500)
    except Exception as e:
        logger.error('Unexpected error in get_profile_photo: %s', str(e))
        return Response('An unexpected error occurred', status=500)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)