import os
import sqlite3
import jwt
import datetime
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps

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
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS secrets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                secret TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        ''')
        db.commit()


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
        
        if not token:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        try:
            payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
            current_user_id = payload['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid authentication token'}), 401
        
        return f(current_user_id, *args, **kwargs)
    return decorated


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data.get('email', '').strip()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not email or not username or not password:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Basic email validation
    if '@' not in email or '.' not in email.split('@')[-1]:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    password_hash = generate_password_hash(password)
    
    db = get_db()
    try:
        db.execute(
            'INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)',
            (email, username, password_hash)
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
    
    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    payload = {
        'user_id': user['id'],
        'username': user['username'],
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
    
    return jsonify({'token': token, 'message': 'Login successful'}), 200


@app.route('/set_secret', methods=['POST'])
@token_required
def set_secret(current_user_id):
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    username = data.get('username', '').strip()
    secret = data.get('secret', '')
    
    if not username or secret is None:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    db = get_db()
    
    # Verify the username matches the token's user
    user = db.execute('SELECT * FROM users WHERE id = ?', (current_user_id,)).fetchone()
    if not user or user['username'] != username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    # Check if secret already exists for this user
    existing = db.execute('SELECT * FROM secrets WHERE user_id = ?', (current_user_id,)).fetchone()
    if existing:
        db.execute('UPDATE secrets SET secret = ? WHERE user_id = ?', (secret, current_user_id))
    else:
        db.execute('INSERT INTO secrets (user_id, secret) VALUES (?, ?)', (current_user_id, secret))
    db.commit()
    
    return jsonify({'message': 'Secret has been set successfully'}), 200


@app.route('/get_secret', methods=['GET'])
@token_required
def get_secret(current_user_id):
    username = request.args.get('username', '').strip()
    
    if not username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    db = get_db()
    
    # Verify the username matches the token's user
    user = db.execute('SELECT * FROM users WHERE id = ?', (current_user_id,)).fetchone()
    if not user or user['username'] != username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    
    secret_row = db.execute('SELECT secret FROM secrets WHERE user_id = ?', (current_user_id,)).fetchone()
    
    if not secret_row:
        return jsonify({'secret': ''}), 200
    
    return jsonify({'secret': secret_row['secret']}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
else:
    init_db()