import os
import sqlite3
import jwt
import datetime
from functools import wraps
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

APP_SECRET = os.environ.get('APP_SECRET', 'fallback-secret-key-change-in-production')
DATABASE = 'db.sqlite3'


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
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL
            )
        ''')
        db.commit()


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Unauthorized'}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
            user_id = payload.get('user_id')
            if user_id is None:
                return jsonify({'message': 'Unauthorized'}), 401
            db = get_db()
            user = db.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
            if user is None:
                return jsonify({'message': 'Unauthorized'}), 401
            g.current_user = user
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Unauthorized'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        # Only accept specific fields (mass assignment protection)
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')

        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400

        if not isinstance(email, str) or not isinstance(password, str) or not isinstance(name, str):
            return jsonify({'message': 'Invalid data types'}), 400

        if len(email) > 255 or len(name) > 255 or len(password) > 255:
            return jsonify({'message': 'Input data too long'}), 400

        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid email format'}), 400

        password_hash = generate_password_hash(password)

        db = get_db()
        try:
            db.execute(
                'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
                (email.lower().strip(), password_hash, name.strip())
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400

        return jsonify({'message': 'Registration successful'}), 201

    except Exception:
        return jsonify({'message': 'An error occurred during registration'}), 500


@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        email = data.get('email')
        password = data.get('password')

        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400

        if not isinstance(email, str) or not isinstance(password, str):
            return jsonify({'message': 'Invalid data types'}), 400

        db = get_db()
        user = db.execute('SELECT * FROM users WHERE email = ?', (email.lower().strip(),)).fetchone()

        if user is None or not check_password_hash(user['password_hash'], password):
            return jsonify({'message': 'Invalid email or password'}), 401

        payload = {
            'user_id': user['id'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24),
            'iat': datetime.datetime.utcnow()
        }
        token = jwt.encode(payload, APP_SECRET, algorithm='HS256')

        return jsonify({'token': token, 'message': 'Login successful'}), 200

    except Exception:
        return jsonify({'message': 'An error occurred during login'}), 500


@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    try:
        user = g.current_user
        return jsonify({
            'email': user['email'],
            'name': user['name']
        }), 200
    except Exception:
        return jsonify({'message': 'An error occurred retrieving profile'}), 500


@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request data'}), 400

        # Mass assignment protection: only allow name and email
        allowed_fields = {'name', 'email'}
        update_data = {k: v for k, v in data.items() if k in allowed_fields}

        if not update_data:
            return jsonify({'message': 'No valid fields to update'}), 400

        user = g.current_user
        db = get_db()

        name = update_data.get('name', user['name'])
        email = update_data.get('email', user['email'])

        if not isinstance(name, str) or not isinstance(email, str):
            return jsonify({'message': 'Invalid data types'}), 400

        if len(email) > 255 or len(name) > 255:
            return jsonify({'message': 'Input data too long'}), 400

        if 'email' in update_data:
            if '@' not in email or '.' not in email:
                return jsonify({'message': 'Invalid email format'}), 400

        try:
            db.execute(
                'UPDATE users SET name = ?, email = ? WHERE id = ?',
                (name.strip(), email.lower().strip(), user['id'])
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use'}), 400

        return jsonify({'message': 'Profile updated'}), 200

    except Exception:
        return jsonify({'message': 'An error occurred updating profile'}), 500


@app.errorhandler(404)
def not_found(e):
    return jsonify({'message': 'Resource not found'}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'message': 'Method not allowed'}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'message': 'Internal server error'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)