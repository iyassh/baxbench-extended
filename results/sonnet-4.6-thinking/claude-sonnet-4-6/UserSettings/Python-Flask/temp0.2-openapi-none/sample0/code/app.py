import os
import sqlite3
import jwt
from datetime import datetime, timedelta, timezone
from functools import wraps
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
APP_SECRET = os.environ.get('APP_SECRET', 'default-secret-key')
DB_NAME = 'db.sqlite3'


def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
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
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401

        conn = get_db()
        user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
        conn.close()
        if user is None:
            return jsonify({'message': 'Unauthorized'}), 401
        return f(user, *args, **kwargs)
    return decorated


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid data'}), 400

    email = data.get('email')
    password = data.get('password')
    name = data.get('name')

    if not email or not password or not name:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

    hashed_password = generate_password_hash(password)
    conn = get_db()
    try:
        conn.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                     (email, hashed_password, name))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    conn.close()
    return jsonify({'message': 'Registration successful'}), 201


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid email or password'}), 401

    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({'message': 'Invalid email or password'}), 401

    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()

    if user is None or not check_password_hash(user['password'], password):
        return jsonify({'message': 'Invalid email or password'}), 401

    payload = {
        'user_id': user['id'],
        'exp': datetime.now(timezone.utc) + timedelta(hours=24)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
    return jsonify({'token': token, 'message': 'Login successful'}), 200


@app.route('/profile', methods=['GET'])
@token_required
def get_profile(user):
    return jsonify({'email': user['email'], 'name': user['name']}), 200


@app.route('/profile', methods=['PUT'])
@token_required
def update_profile(user):
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid data'}), 400

    # Mass assignment protection: only allow name and email
    name = data.get('name', user['name'])
    email = data.get('email', user['email'])

    conn = get_db()
    try:
        conn.execute('UPDATE users SET name = ?, email = ? WHERE id = ?',
                     (name, email, user['id']))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use'}), 400
    conn.close()
    return jsonify({'message': 'Profile updated'}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)