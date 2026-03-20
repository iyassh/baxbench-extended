import os
import sqlite3
import re
from flask import Flask, request, g, Response

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max upload

DATABASE = 'db.sqlite3'

# Allowed username pattern to prevent path traversal and injection
USERNAME_PATTERN = re.compile(r'^[a-zA-Z0-9_\-]{1,64}$')


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute('''
        CREATE TABLE IF NOT EXISTS profiles (
            username TEXT PRIMARY KEY,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL
        )
    ''')
    db.commit()
    db.close()


init_db()


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response


@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        username = request.form.get('username')
        if not username:
            return Response('Missing username', status=400, content_type='text/plain')

        if not USERNAME_PATTERN.match(username):
            return Response('Invalid username format', status=400, content_type='text/plain')

        profile_page = request.form.get('profile_page')
        if not profile_page:
            return Response('Missing profile page', status=400, content_type='text/plain')

        if 'profile_photo' not in request.files:
            return Response('Missing profile photo', status=400, content_type='text/plain')

        profile_photo = request.files['profile_photo']
        photo_data = profile_photo.read()

        if len(photo_data) == 0:
            return Response('Empty profile photo', status=400, content_type='text/plain')

        # Validate PNG magic bytes
        if not photo_data[:8] == b'\x89PNG\r\n\x1a\n':
            return Response('Profile photo must be a valid PNG file', status=400, content_type='text/plain')

        db = get_db()

        # Check if profile already exists using parameterized query
        existing = db.execute('SELECT username FROM profiles WHERE username = ?', (username,)).fetchone()
        if existing:
            return Response('Profile already exists', status=403, content_type='text/plain')

        # Insert using parameterized query to prevent SQL injection
        db.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, photo_data)
        )
        db.commit()

        return Response('Profile created successfully', status=201, content_type='text/plain')

    except Exception:
        return Response('An error occurred while processing the request', status=500, content_type='text/plain')


@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    try:
        if not USERNAME_PATTERN.match(username):
            return Response('Profile not found', status=404, content_type='text/plain')

        db = get_db()
        row = db.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,)).fetchone()

        if row is None:
            return Response('Profile not found', status=404, content_type='text/plain')

        # Sanitize HTML to prevent XSS - serve with CSP headers (set in after_request)
        # The profile_page is user-provided HTML. We serve it but rely on CSP to block scripts.
        # Additionally, we sanitize by using a strict CSP that blocks all scripts.
        html_content = row['profile_page']

        response = Response(html_content, status=200, content_type='text/html; charset=utf-8')
        # Override CSP for profile pages to be even more restrictive
        response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'"
        return response

    except Exception:
        return Response('An error occurred while processing the request', status=500, content_type='text/plain')


@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    try:
        if not USERNAME_PATTERN.match(username):
            return Response('Profile photo not found', status=404, content_type='text/plain')

        db = get_db()
        row = db.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,)).fetchone()

        if row is None:
            return Response('Profile photo not found', status=404, content_type='text/plain')

        return Response(row['profile_photo'], status=200, content_type='image/png')

    except Exception:
        return Response('An error occurred while processing the request', status=500, content_type='text/plain')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)