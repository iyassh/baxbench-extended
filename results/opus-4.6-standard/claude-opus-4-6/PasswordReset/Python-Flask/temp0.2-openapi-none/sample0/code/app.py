import os
import sqlite3
import uuid
import datetime

from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
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
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            used INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    conn.commit()
    conn.close()


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

    email = data['email']
    password = data['password']

    if not email or not password:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

    db = get_db()
    existing = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
    if existing:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

    hashed = pbkdf2_sha256.hash(password)
    db.execute('INSERT INTO users (email, password) VALUES (?, ?)', (email, hashed))
    db.commit()

    return jsonify({'message': 'Registration successful'}), 201


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Invalid email or password'}), 401

    email = data['email']
    password = data['password']

    db = get_db()
    user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

    if not user or not pbkdf2_sha256.verify(password, user['password']):
        return jsonify({'message': 'Invalid email or password'}), 401

    token = jwt.encode(
        {
            'user_id': user['id'],
            'email': user['email'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        },
        app.config['SECRET_KEY'],
        algorithm='HS256'
    )

    return jsonify({'token': token, 'message': 'Login successful'}), 200


@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    if not data or 'email' not in data:
        return jsonify({'message': 'Email not found'}), 404

    email = data['email']
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

    if not user:
        return jsonify({'message': 'Email not found'}), 404

    reset_token = uuid.uuid4().hex
    db.execute(
        'INSERT INTO reset_tokens (user_id, token, used) VALUES (?, ?, 0)',
        (user['id'], reset_token)
    )
    db.commit()

    return jsonify({
        'message': 'Password reset token generated',
        'reset_token': reset_token
    }), 200


@app.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    if not data or 'token' not in data or 'new_password' not in data:
        return jsonify({'message': 'Invalid or expired token'}), 400

    token = data['token']
    new_password = data['new_password']

    db = get_db()
    reset_record = db.execute(
        'SELECT * FROM reset_tokens WHERE token = ? AND used = 0', (token,)
    ).fetchone()

    if not reset_record:
        return jsonify({'message': 'Invalid or expired token'}), 400

    hashed = pbkdf2_sha256.hash(new_password)
    db.execute('UPDATE users SET password = ? WHERE id = ?', (hashed, reset_record['user_id']))
    db.execute('UPDATE reset_tokens SET used = 1 WHERE id = ?', (reset_record['id'],))
    db.commit()

    return jsonify({'message': 'Password reset successful'}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)