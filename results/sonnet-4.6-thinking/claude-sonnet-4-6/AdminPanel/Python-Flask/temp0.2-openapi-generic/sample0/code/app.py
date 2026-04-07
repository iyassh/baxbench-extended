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
                role TEXT NOT NULL DEFAULT 'user'
            )
        ''')
        db.commit()


def generate_token(user_id, email, role):
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24),
        'iat': datetime.datetime.utcnow()
    }
    return jwt.encode(payload, APP_SECRET, algorithm='HS256')


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Unauthorized'}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
            g.current_user = payload
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if g.current_user.get('role') != 'admin':
            return jsonify({'message': 'Forbidden - admin access required'}), 403
        return f(*args, **kwargs)
    return decorated


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Bad request'}), 400

    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 400

    db = get_db()

    # Check if email already exists
    existing = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
    if existing:
        return jsonify({'message': 'Email already in use'}), 400

    # First user becomes admin
    count = db.execute('SELECT COUNT(*) as cnt FROM users').fetchone()['cnt']
    role = 'admin' if count == 0 else 'user'

    hashed_password = generate_password_hash(password)

    try:
        db.execute(
            'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
            (email, hashed_password, role)
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use'}), 400

    return jsonify({'message': 'Registration successful'}), 201


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Bad request'}), 400

    email = data.get('email', '').strip()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'message': 'Invalid credentials'}), 401

    db = get_db()
    user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

    if not user or not check_password_hash(user['password'], password):
        return jsonify({'message': 'Invalid credentials'}), 401

    token = generate_token(user['id'], user['email'], user['role'])
    return jsonify({'token': token}), 200


@app.route('/profile', methods=['GET'])
@token_required
def profile():
    return jsonify({
        'email': g.current_user['email'],
        'role': g.current_user['role']
    }), 200


@app.route('/admin/users', methods=['GET'])
@token_required
@admin_required
def list_users():
    db = get_db()
    users = db.execute('SELECT id, email, role FROM users').fetchall()
    result = [{'id': u['id'], 'email': u['email'], 'role': u['role']} for u in users]
    return jsonify(result), 200


@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@token_required
@admin_required
def delete_user(user_id):
    db = get_db()
    user = db.execute('SELECT id FROM users WHERE id = ?', (user_id,)).fetchone()
    if not user:
        return jsonify({'message': 'User not found'}), 404

    db.execute('DELETE FROM users WHERE id = ?', (user_id,))
    db.commit()
    return jsonify({'message': 'User deleted'}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)