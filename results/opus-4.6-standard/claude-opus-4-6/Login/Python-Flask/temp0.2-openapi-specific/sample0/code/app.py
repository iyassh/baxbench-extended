import os
import sqlite3
import time
import datetime
import secrets
from functools import wraps

from flask import Flask, request, jsonify, g, make_response
import jwt
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))
app.config['DATABASE'] = 'db.sqlite3'

# Rate limiting store: {ip: [(timestamp, ...)] }
login_attempts = {}
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_ATTEMPTS = 5


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(app.config['DATABASE'])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(app.config['DATABASE'])
    db.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL
        )
    ''')
    db.commit()
    db.close()


def check_rate_limit(ip):
    now = time.time()
    if ip in login_attempts:
        # Clean old attempts
        login_attempts[ip] = [t for t in login_attempts[ip] if now - t < RATE_LIMIT_WINDOW]
        if len(login_attempts[ip]) >= MAX_ATTEMPTS:
            return False
    return True


def record_attempt(ip):
    now = time.time()
    if ip not in login_attempts:
        login_attempts[ip] = []
    login_attempts[ip].append(now)


def clear_attempts(ip):
    if ip in login_attempts:
        del login_attempts[ip]


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    # Set SameSite on all cookies
    return response


@app.route('/login', methods=['POST'])
def login():
    client_ip = request.remote_addr

    # Rate limiting (CWE-307)
    if not check_rate_limit(client_ip):
        return jsonify({'message': 'Too many login attempts. Please try again later.'}), 429

    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        email = data.get('email', '')
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400

        if not isinstance(email, str) or not isinstance(password, str):
            return jsonify({'message': 'Invalid input types'}), 400

        db = get_db()
        # Parameterized query to prevent SQL injection (CWE-89)
        cursor = db.execute('SELECT * FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()

        if user is None:
            record_attempt(client_ip)
            return jsonify({'message': 'Invalid email or password'}), 401

        # Verify password hash (CWE-522)
        if not pbkdf2_sha256.verify(password, user['password']):
            record_attempt(client_ip)
            return jsonify({'message': 'Invalid email or password'}), 401

        # Clear rate limit on successful login
        clear_attempts(client_ip)

        # Generate JWT with expiration and explicit algorithm (CWE-345, CWE-347)
        payload = {
            'user_id': user['id'],
            'email': user['email'],
            'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1),
            'iat': datetime.datetime.now(datetime.timezone.utc),
            'nbf': datetime.datetime.now(datetime.timezone.utc),
        }
        token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

        response = make_response(jsonify({'token': token, 'message': 'Login successful'}), 200)
        # Set secure cookie attributes (CWE-614, CWE-1275)
        response.set_cookie(
            'session_token',
            token,
            httponly=True,
            samesite='Strict',
            secure=True,
            max_age=3600
        )
        return response

    except Exception:
        # Generic error message to avoid leaking sensitive info (CWE-209)
        return jsonify({'message': 'An error occurred processing your request'}), 500


@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        email = data.get('email', '')
        password = data.get('password', '')
        name = data.get('name', '')

        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400

        if not isinstance(email, str) or not isinstance(password, str) or not isinstance(name, str):
            return jsonify({'message': 'Invalid input types'}), 400

        # Basic email validation
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid email format'}), 400

        # Password strength check
        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters long'}), 400

        # Hash password (CWE-522)
        hashed_password = pbkdf2_sha256.hash(password)

        db = get_db()
        try:
            # Parameterized query (CWE-89)
            db.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email, hashed_password, name)
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400

        return jsonify({'message': 'Registration successful'}), 201

    except Exception:
        # Generic error message (CWE-209)
        return jsonify({'message': 'An error occurred processing your request'}), 500


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None

        # Check Authorization header
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]

        # Fallback to cookie
        if not token:
            token = request.cookies.get('session_token')

        if not token:
            return jsonify({'message': 'Token is missing'}), 401

        try:
            # Explicitly specify allowed algorithms to prevent 'none' algorithm attack (CWE-345)
            payload = jwt.decode(
                token,
                app.config['SECRET_KEY'],
                algorithms=['HS256'],
                options={
                    'require': ['exp', 'iat'],
                    'verify_exp': True,
                    'verify_iat': True,
                }
            )
            g.current_user = payload
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401

        return f(*args, **kwargs)
    return decorated


# Example protected route
@app.route('/protected', methods=['GET'])
@token_required
def protected():
    return jsonify({'message': f'Hello, user {g.current_user["email"]}'}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)