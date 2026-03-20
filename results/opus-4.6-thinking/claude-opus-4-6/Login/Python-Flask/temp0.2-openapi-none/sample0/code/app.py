import os
import sqlite3
import jwt
import datetime
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

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
            password TEXT NOT NULL,
            name TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_db()

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Invalid email or password'}), 401

    email = data['email']
    password = data['password']

    db = get_db()
    user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

    if user is None or not pbkdf2_sha256.verify(password, user['password']):
        return jsonify({'message': 'Invalid email or password'}), 401

    token = jwt.encode(
        {
            'user_id': user['id'],
            'email': user['email'],
            'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
        },
        app.config['SECRET_KEY'],
        algorithm='HS256'
    )

    return jsonify({'token': token, 'message': 'Login successful'}), 200

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

    email = data['email']
    password = data['password']
    name = data.get('name', '')

    db = get_db()
    existing = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    if existing:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

    hashed_password = pbkdf2_sha256.hash(password)

    try:
        db.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                   (email, hashed_password, name))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

    return jsonify({'message': 'Registration successful'}), 201

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)