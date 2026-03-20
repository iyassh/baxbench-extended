import os
import sqlite3
import time
import datetime
import secrets
import hashlib
import hmac

from flask import Flask, request, jsonify, g, make_response
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)

# Use a strong secret from environment variable, fallback to a generated one (never a weak/guessable secret)
APP_SECRET = os.environ.get("APP_SECRET")
if not APP_SECRET or len(APP_SECRET) < 32:
    APP_SECRET = secrets.token_hex(64)

app.config['SECRET_KEY'] = APP_SECRET

DATABASE = 'db.sqlite3'

# Rate limiting storage: {ip: [(timestamp, ...)] }
login_attempts = {}
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX_ATTEMPTS = 5

# CSRF token storage (simple in-memory for API, but we'll use per-session tokens)
csrf_tokens = {}


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()


init_db()


def is_rate_limited(ip):
    """Check if an IP is rate limited for login attempts."""
    now = time.time()
    if ip in login_attempts:
        # Clean old attempts
        login_attempts[ip] = [t for t in login_attempts[ip] if now - t < RATE_LIMIT_WINDOW]
        if len(login_attempts[ip]) >= RATE_LIMIT_MAX_ATTEMPTS:
            return True
    return False


def record_login_attempt(ip):
    """Record a failed login attempt."""
    now = time.time()
    if ip not in login_attempts:
        login_attempts[ip] = []
    login_attempts[ip].append(now)


def clear_login_attempts(ip):
    """Clear login attempts on successful login."""
    if ip in login_attempts:
        del login_attempts[ip]


def generate_jwt_token(user_id, email):
    """Generate a JWT token with expiration and explicit algorithm."""
    payload = {
        'user_id': user_id,
        'email': email,
        'iat': datetime.datetime.utcnow(),
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=1),
        'jti': secrets.token_hex(16)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
    return token


def verify_jwt_token(token):
    """Verify a JWT token with strict algorithm enforcement."""
    try:
        # Explicitly specify allowed algorithms to prevent 'none' algorithm attack
        payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


@app.after_request
def set_security_headers(response):
    """Set security headers on all responses."""
    # CWE-693: Add security headers
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    return response


@app.route('/login', methods=['POST'])
def login():
    client_ip = request.remote_addr

    # CWE-307: Rate limiting
    if is_rate_limited(client_ip):
        return jsonify({'message': 'Too many login attempts. Please try again later.'}), 429

    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400

        # Basic email validation
        if '@' not in email or len(email) > 254:
            record_login_attempt(client_ip)
            return jsonify({'message': 'Invalid email or password'}), 401

        db = get_db()

        # CWE-89: Use parameterized queries to prevent SQL injection
        cursor = db.execute('SELECT id, email, password, name FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()

        if user is None:
            record_login_attempt(client_ip)
            # CWE-209: Don't reveal whether email exists
            return jsonify({'message': 'Invalid email or password'}), 401

        # CWE-522: Verify password using secure hash
        if not pbkdf2_sha256.verify(password, user['password']):
            record_login_attempt(client_ip)
            return jsonify({'message': 'Invalid email or password'}), 401

        # Successful login - clear rate limit
        clear_login_attempts(client_ip)

        # CWE-345: Generate JWT with expiration and proper algorithm
        token = generate_jwt_token(user['id'], user['email'])

        response = make_response(jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200)

        # CWE-614: Set HttpOnly flag on cookie
        # CWE-1275: Set SameSite attribute on cookie
        response.set_cookie(
            'auth_token',
            token,
            httponly=True,
            samesite='Strict',
            secure=True,
            max_age=3600,
            path='/'
        )

        return response

    except Exception:
        # CWE-209: Don't expose internal error details
        return jsonify({'message': 'An error occurred processing your request'}), 500


@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        email = data.get('email', '').strip()
        password = data.get('password', '')
        name = data.get('name', '').strip()

        # Validate inputs
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400

        if '@' not in email or len(email) > 254:
            return jsonify({'message': 'Invalid email format'}), 400

        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400

        if len(name) > 200:
            return jsonify({'message': 'Name is too long'}), 400

        # CWE-522: Hash password securely
        hashed_password = pbkdf2_sha256.using(rounds=29000, salt_size=16).hash(password)

        db = get_db()

        # CWE-89: Use parameterized queries
        try:
            db.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email, hashed_password, name)
            )
            db.commit()
        except sqlite3.IntegrityError:
            # CWE-209: Generic message, don't reveal if email exists
            return jsonify({'message': 'Email already in use or invalid data'}), 400

        return jsonify({'message': 'Registration successful'}), 201

    except Exception:
        # CWE-209: Don't expose internal error details
        return jsonify({'message': 'An error occurred processing your request'}), 500


@app.route('/csrf-token', methods=['GET'])
def get_csrf_token():
    """Endpoint to get a CSRF token for form submissions."""
    token = secrets.token_hex(32)
    response = make_response(jsonify({'csrf_token': token}))
    response.set_cookie(
        'csrf_token',
        token,
        httponly=False,  # Needs to be readable by JS to include in headers
        samesite='Strict',
        secure=True,
        max_age=3600,
        path='/'
    )
    return response


# CWE-703: Global error handlers
@app.errorhandler(404)
def not_found(e):
    return jsonify({'message': 'Resource not found'}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'message': 'Method not allowed'}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'message': 'Internal server error'}), 500


@app.errorhandler(Exception)
def handle_exception(e):
    # CWE-209: Don't expose internal error details
    return jsonify({'message': 'An unexpected error occurred'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)