import os
import sqlite3
from flask import Flask, request, g, Response

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB max upload size

DATABASE = 'db.sqlite3'

# Maximum sizes for individual fields
MAX_USERNAME_LENGTH = 100
MAX_HTML_SIZE = 1 * 1024 * 1024  # 1MB
MAX_PHOTO_SIZE = 2 * 1024 * 1024  # 2MB


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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL
        )
    ''')
    db.commit()
    db.close()


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = (
        "default-src 'none'; "
        "img-src 'self'; "
        "style-src 'self'; "
        "frame-ancestors 'none';"
    )
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


def sanitize_username(username):
    """Validate and sanitize username to only allow alphanumeric characters, hyphens, and underscores."""
    if not username:
        return None
    if len(username) > MAX_USERNAME_LENGTH:
        return None
    # Only allow safe characters
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', username):
        return None
    return username


def sanitize_html(html_content):
    """
    Sanitize HTML content to prevent XSS attacks.
    Strip script tags and event handlers.
    """
    import re
    if not html_content:
        return html_content

    # Remove script tags and their content
    html_content = re.sub(r'<script[^>]*>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    # Remove event handlers (on* attributes)
    html_content = re.sub(r'\s+on\w+\s*=\s*["\'][^"\']*["\']', '', html_content, flags=re.IGNORECASE)
    html_content = re.sub(r'\s+on\w+\s*=\s*\S+', '', html_content, flags=re.IGNORECASE)
    # Remove javascript: URLs
    html_content = re.sub(r'href\s*=\s*["\']?\s*javascript:', 'href="', html_content, flags=re.IGNORECASE)
    html_content = re.sub(r'src\s*=\s*["\']?\s*javascript:', 'src="', html_content, flags=re.IGNORECASE)
    # Remove data: URLs that could contain scripts
    html_content = re.sub(r'src\s*=\s*["\']?\s*data:text/html', 'src="', html_content, flags=re.IGNORECASE)
    # Remove iframe, object, embed, applet tags
    html_content = re.sub(r'<(iframe|object|embed|applet|form|input|button|textarea|select)[^>]*>.*?</\1>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<(iframe|object|embed|applet|form|input|button|textarea|select)[^>]*/?\s*>', '', html_content, flags=re.IGNORECASE)
    # Remove base tag
    html_content = re.sub(r'<base[^>]*>', '', html_content, flags=re.IGNORECASE)
    # Remove meta refresh
    html_content = re.sub(r'<meta[^>]*http-equiv\s*=\s*["\']?refresh[^>]*>', '', html_content, flags=re.IGNORECASE)

    return html_content


@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        username = request.form.get('username')
        if not username:
            return Response('Missing username', status=400, content_type='text/plain')

        username = sanitize_username(username)
        if username is None:
            return Response('Invalid username. Only alphanumeric characters, hyphens, and underscores are allowed (max 100 chars).', status=400, content_type='text/plain')

        profile_page = request.form.get('profile_page')
        if not profile_page:
            return Response('Missing profile page', status=400, content_type='text/plain')

        if len(profile_page.encode('utf-8')) > MAX_HTML_SIZE:
            return Response('Profile page too large', status=400, content_type='text/plain')

        profile_photo = request.files.get('profile_photo')
        if not profile_photo:
            return Response('Missing profile photo', status=400, content_type='text/plain')

        photo_data = profile_photo.read()
        if len(photo_data) > MAX_PHOTO_SIZE:
            return Response('Profile photo too large', status=400, content_type='text/plain')

        if len(photo_data) == 0:
            return Response('Empty profile photo', status=400, content_type='text/plain')

        # Validate PNG signature
        PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
        if not photo_data.startswith(PNG_SIGNATURE):
            return Response('Profile photo must be a valid PNG file', status=400, content_type='text/plain')

        # Sanitize HTML content to prevent XSS
        profile_page = sanitize_html(profile_page)

        db = get_db()

        # Check if profile already exists using parameterized query
        cursor = db.execute('SELECT id FROM profiles WHERE username = ?', (username,))
        if cursor.fetchone() is not None:
            return Response('Profile already exists', status=403, content_type='text/plain')

        # Insert new profile using parameterized query
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
        username = sanitize_username(username)
        if username is None:
            return Response('Invalid username', status=400, content_type='text/plain')

        db = get_db()
        cursor = db.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
        row = cursor.fetchone()

        if row is None:
            return Response('Profile not found', status=404, content_type='text/plain')

        response = Response(row['profile_page'], status=200, content_type='text/html')
        # Override CSP for profile pages to allow inline styles but still block scripts
        response.headers['Content-Security-Policy'] = (
            "default-src 'none'; "
            "img-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'none'; "
            "frame-ancestors 'none';"
        )
        return response

    except Exception:
        return Response('An error occurred while processing the request', status=500, content_type='text/plain')


@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    try:
        username = sanitize_username(username)
        if username is None:
            return Response('Invalid username', status=400, content_type='text/plain')

        db = get_db()
        cursor = db.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
        row = cursor.fetchone()

        if row is None:
            return Response('Profile photo not found', status=404, content_type='text/plain')

        return Response(row['profile_photo'], status=200, content_type='image/png')

    except Exception:
        return Response('An error occurred while processing the request', status=500, content_type='text/plain')


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)