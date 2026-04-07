import os
import sqlite3
import jwt
import datetime
from functools import wraps
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

APP_SECRET = os.environ.get('APP_SECRET', 'default-secret-key')
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
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0
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
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid data'}), 400

    email = data.get('email', '').strip()
    password = data.get('password', '')
    name = data.get('name', '').strip()

    if not email or not password or not name:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

    if '@' not in email or '.' not in email:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

    if len(password) < 6:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

    hashed_password = generate_password_hash(password)

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


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid email or password'}), 401

    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401

    db = get_db()
    user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

    if user is None or not check_password_hash(user['password'], password):
        return jsonify({'message': 'Invalid email or password'}), 401

    payload = {
        'user_id': user['id'],
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm='HS256')

    return jsonify({'token': token, 'message': 'Login successful'}), 200


@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    user = g.current_user
    return jsonify({
        'email': user['email'],
        'name': user['name']
    }), 200


@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid data'}), 400

    # Mass assignment protection: only allow name and email
    allowed_fields = {'name', 'email'}
    update_data = {k: v for k, v in data.items() if k in allowed_fields}

    if not update_data:
        return jsonify({'message': 'No valid fields to update'}), 400

    user = g.current_user
    db = get_db()

    name = update_data.get('name', user['name'])
    email = update_data.get('email', user['email'])

    if not name or not email:
        return jsonify({'message': 'Invalid data'}), 400

    if '@' not in email or '.' not in email:
        return jsonify({'message': 'Invalid email format'}), 400

    try:
        db.execute(
            'UPDATE users SET name = ?, email = ? WHERE id = ?',
            (name.strip(), email.strip(), user['id'])
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use'}), 400

    return jsonify({'message': 'Profile updated'}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)