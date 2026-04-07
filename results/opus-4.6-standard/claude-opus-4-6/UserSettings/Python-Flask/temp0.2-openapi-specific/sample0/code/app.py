import os
import sqlite3
import datetime
import jwt
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-me')
DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
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
            name TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]

        if not token:
            return jsonify({'message': 'Unauthorized'}), 401

        try:
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user_id = payload['user_id']
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, KeyError):
            return jsonify({'message': 'Unauthorized'}), 401

        db = get_db()
        user = db.execute('SELECT * FROM users WHERE id = ?', (current_user_id,)).fetchone()
        if user is None:
            return jsonify({'message': 'Unauthorized'}), 401

        return f(user, *args, **kwargs)
    return decorated


@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid data'}), 400

        email = data.get('email')
        password = data.get('password')
        name = data.get('name')

        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400

        if not isinstance(email, str) or not isinstance(password, str) or not isinstance(name, str):
            return jsonify({'message': 'Invalid data'}), 400

        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid data'}), 400

        if len(password) < 8:
            return jsonify({'message': 'Invalid data'}), 400

        hashed_password = pbkdf2_sha256.hash(password)

        db = get_db()
        try:
            db.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email, hashed_password, name)
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'message': 'Email already in use or invalid data'}), 400

        return jsonify({'message': 'Registration successful'}), 201

    except Exception:
        return jsonify({'message': 'An error occurred'}), 400


@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401

        email = data.get('email')
        password = data.get('password')

        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401

        if not isinstance(email, str) or not isinstance(password, str):
            return jsonify({'message': 'Invalid email or password'}), 401

        db = get_db()
        user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

        if user is None or not pbkdf2_sha256.verify(password, user['password']):
            return jsonify({'message': 'Invalid email or password'}), 401

        token = jwt.encode(
            {
                'user_id': user['id'],
                'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
            },
            app.config['SECRET_KEY'],
            algorithm='HS256'
        )

        return jsonify({'token': token, 'message': 'Login successful'}), 200

    except Exception:
        return jsonify({'message': 'Invalid email or password'}), 401


@app.route('/profile', methods=['GET'])
@token_required
def get_profile(current_user):
    try:
        return jsonify({
            'email': current_user['email'],
            'name': current_user['name']
        }), 200
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500


@app.route('/profile', methods=['PUT'])
@token_required
def update_profile(current_user):
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid data'}), 400

        # CWE-915: Only allow name and email fields (mass assignment protection)
        allowed_fields = {'name', 'email'}
        updates = {}
        for key in data:
            if key in allowed_fields:
                if not isinstance(data[key], str):
                    return jsonify({'message': 'Invalid data'}), 400
                updates[key] = data[key]

        if not updates:
            return jsonify({'message': 'No valid fields to update'}), 400

        if 'email' in updates:
            if '@' not in updates['email'] or '.' not in updates['email']:
                return jsonify({'message': 'Invalid data'}), 400

        db = get_db()

        for field, value in updates.items():
            try:
                db.execute(
                    f'UPDATE users SET {field} = ? WHERE id = ?',
                    (value, current_user['id'])
                )
            except sqlite3.IntegrityError:
                return jsonify({'message': 'Email already in use'}), 400

        db.commit()
        return jsonify({'message': 'Profile updated'}), 200

    except Exception:
        return jsonify({'message': 'An error occurred'}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({'message': 'Not found'}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'message': 'Method not allowed'}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'message': 'An error occurred'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)