import os
import sqlite3
import re
from flask import Flask, request, jsonify, g, Response

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024  # 2MB max upload size

DATABASE = 'db.sqlite3'
MAX_USERNAME_LENGTH = 64
MAX_PROFILE_PAGE_LENGTH = 100 * 1024  # 100KB

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
                username TEXT PRIMARY KEY NOT NULL,
                profile_page TEXT NOT NULL,
                profile_photo BLOB NOT NULL
            )
        ''')
        db.commit()

def is_valid_username(username):
    if not username or len(username) > MAX_USERNAME_LENGTH:
        return False
    # Only allow alphanumeric, underscore, hyphen
    return bool(re.match(r'^[a-zA-Z0-9_\-]+$', username))

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        username = request.form.get('username', '').strip()
        profile_page = request.form.get('profile_page', '')
        profile_photo = request.files.get('profile_photo')

        if not username or not profile_page or not profile_photo:
            return jsonify({'error': 'Missing required fields'}), 400

        if not is_valid_username(username):
            return jsonify({'error': 'Invalid username'}), 400

        if len(profile_page) > MAX_PROFILE_PAGE_LENGTH:
            return jsonify({'error': 'Profile page content too large'}), 400

        # Validate profile photo is PNG
        photo_data = profile_photo.read(8)
        if len(photo_data) < 8 or photo_data[:8] != b'\x89PNG\r\n\x1a\n':
            return jsonify({'error': 'Profile photo must be a valid PNG image'}), 400
        # Read the rest
        photo_data += profile_photo.read()

        db = get_db()
        existing = db.execute(
            'SELECT username FROM profiles WHERE username = ?', (username,)
        ).fetchone()

        if existing:
            return jsonify({'error': 'Profile already exists'}), 403

        db.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, sqlite3.Binary(photo_data))
        )
        db.commit()

        return jsonify({'message': 'Profile created successfully'}), 201

    except Exception:
        return jsonify({'error': 'An error occurred processing your request'}), 500

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    try:
        if not is_valid_username(username):
            return jsonify({'error': 'Profile not found'}), 404

        db = get_db()
        row = db.execute(
            'SELECT profile_page FROM profiles WHERE username = ?', (username,)
        ).fetchone()

        if row is None:
            return jsonify({'error': 'Profile not found'}), 404

        # Return the HTML content as-is but with a restrictive CSP
        response = Response(row['profile_page'], status=200, mimetype='text/html')
        # Override CSP for profile pages to be more restrictive
        response.headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'"
        return response

    except Exception:
        return jsonify({'error': 'An error occurred processing your request'}), 500

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    try:
        if not is_valid_username(username):
            return jsonify({'error': 'Profile photo not found'}), 404

        db = get_db()
        row = db.execute(
            'SELECT profile_photo FROM profiles WHERE username = ?', (username,)
        ).fetchone()

        if row is None:
            return jsonify({'error': 'Profile photo not found'}), 404

        return Response(bytes(row['profile_photo']), status=200, mimetype='image/png')

    except Exception:
        return jsonify({'error': 'An error occurred processing your request'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)