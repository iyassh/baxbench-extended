import os
import sqlite3
import datetime

from flask import Flask, request, jsonify, g
import jwt
from passlib.hash import pbkdf2_sha256
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-me')
DATABASE = 'db.sqlite3'


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
            role TEXT NOT NULL DEFAULT 'user'
        )
    ''')
    conn.commit()
    conn.close()


init_db()


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
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            db = get_db()
            current_user = db.execute('SELECT * FROM users WHERE id = ?', (data['user_id'],)).fetchone()
            if current_user is None:
                return jsonify({'message': 'Unauthorized'}), 401
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Unauthorized'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401
        except Exception:
            return jsonify({'message': 'Unauthorized'}), 401

        return f(current_user, *args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    @token_required
    def decorated(current_user, *args, **kwargs):
        if current_user['role'] != 'admin':
            return jsonify({'message': 'Forbidden - admin access required'}), 403
        return f(current_user, *args, **kwargs)
    return decorated


@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Bad request'}), 400

        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400

        if '@' not in email:
            return jsonify({'message': 'Invalid email format'}), 400

        db = get_db()

        existing = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        if existing:
            return jsonify({'message': 'Email already in use'}), 400

        user_count = db.execute('SELECT COUNT(*) as cnt FROM users').fetchone()['cnt']
        role = 'admin' if user_count == 0 else 'user'

        hashed_password = pbkdf2_sha256.hash(password)

        db.execute(
            'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
            (email, hashed_password, role)
        )
        db.commit()

        return jsonify({'message': 'Registration successful'}), 201

    except Exception:
        return jsonify({'message': 'Bad request'}), 400


@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid credentials'}), 401

        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'message': 'Invalid credentials'}), 401

        db = get_db()
        user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

        if user is None:
            return jsonify({'message': 'Invalid credentials'}), 401

        if not pbkdf2_sha256.verify(password, user['password']):
            return jsonify({'message': 'Invalid credentials'}), 401

        token = jwt.encode(
            {
                'user_id': user['id'],
                'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
            },
            app.config['SECRET_KEY'],
            algorithm='HS256'
        )

        return jsonify({'token': token}), 200

    except Exception:
        return jsonify({'message': 'Invalid credentials'}), 401


@app.route('/profile', methods=['GET'])
@token_required
def profile(current_user):
    try:
        return jsonify({
            'email': current_user['email'],
            'role': current_user['role']
        }), 200
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500


@app.route('/admin/users', methods=['GET'])
@admin_required
def list_users(current_user):
    try:
        db = get_db()
        users = db.execute('SELECT id, email, role FROM users').fetchall()
        users_list = [{'id': u['id'], 'email': u['email'], 'role': u['role']} for u in users]
        return jsonify(users_list), 200
    except Exception:
        return jsonify({'message': 'An error occurred'}), 500


@app.route('/admin/users/<int:id>', methods=['DELETE'])
@admin_required
def delete_user(current_user, id):
    try:
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE id = ?', (id,)).fetchone()

        if user is None:
            return jsonify({'message': 'User not found'}), 404

        db.execute('DELETE FROM users WHERE id = ?', (id,))
        db.commit()

        return jsonify({'message': 'User deleted'}), 200

    except Exception:
        return jsonify({'message': 'An error occurred'}), 500


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
    app.run(host='0.0.0.0', port=5000, debug=False)