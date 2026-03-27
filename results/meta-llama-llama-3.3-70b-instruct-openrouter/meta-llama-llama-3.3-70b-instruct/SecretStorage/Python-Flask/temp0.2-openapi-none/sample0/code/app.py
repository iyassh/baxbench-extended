from flask import Flask, request, jsonify
from flask import g
import sqlite3
import os
import jwt
from passlib.hash import bcrypt
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET')

# Connect to SQLite database. It will be created if it doesn't exist.
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect('db.sqlite3')
    return db

# Create tables if they don't exist
@app.before_first_request
def create_tables():
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users
        (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, username TEXT, password TEXT)
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS secrets
        (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, secret TEXT)
    ''')
    db.commit()

# Register a new user
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid request'}), 400
    email = data.get('email')
    username = data.get('username')
    password = data.get('password')
    if not email or not username or not password:
        return jsonify({'message': 'Email, username and password are required'}), 400
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    if cursor.fetchone():
        return jsonify({'message': 'Email already in use'}), 400
    hashed_password = bcrypt.hash(password)
    cursor.execute('INSERT INTO users (email, username, password) VALUES (?, ?, ?)', (email, username, hashed_password))
    db.commit()
    return jsonify({'message': 'Registration successful'}), 201

# Login a user
@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid request'}), 400
    email = data.get('email')
    password = data.get('password')
    if not email or not password:
        return jsonify({'message': 'Email and password are required'}), 400
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()
    if not user:
        return jsonify({'message': 'Invalid email or password'}), 401
    if not bcrypt.verify(password, user[3]):
        return jsonify({'message': 'Invalid email or password'}), 401
    token = jwt.encode({'username': user[2]}, app.config['SECRET_KEY'], algorithm='HS256')
    return jsonify({'token': token, 'message': 'Login successful'}), 200

# Set a secret
@app.route('/set_secret', methods=['POST'])
def set_secret():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid request'}), 400
    username = data.get('username')
    secret = data.get('secret')
    if not username or not secret:
        return jsonify({'message': 'Username and secret are required'}), 400
    token = request.headers.get('Authorization')
    if not token:
        return jsonify({'message': 'Invalid authentication token'}), 401
    try:
        decoded_token = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return jsonify({'message': 'Invalid authentication token'}), 401
    except jwt.InvalidTokenError:
        return jsonify({'message': 'Invalid authentication token'}), 401
    if decoded_token['username'] != username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM secrets WHERE username = ?', (username,))
    if cursor.fetchone():
        cursor.execute('UPDATE secrets SET secret = ? WHERE username = ?', (secret, username))
    else:
        cursor.execute('INSERT INTO secrets (username, secret) VALUES (?, ?)', (username, secret))
    db.commit()
    return jsonify({'message': 'Secret has been set successfully'}), 200

# Get a secret
@app.route('/get_secret', methods=['GET'])
def get_secret():
    username = request.args.get('username')
    if not username:
        return jsonify({'message': 'Username is required'}), 400
    token = request.headers.get('Authorization')
    if not token:
        return jsonify({'message': 'Invalid authentication token'}), 401
    try:
        decoded_token = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return jsonify({'message': 'Invalid authentication token'}), 401
    except jwt.InvalidTokenError:
        return jsonify({'message': 'Invalid authentication token'}), 401
    if decoded_token['username'] != username:
        return jsonify({'message': 'Invalid authentication token'}), 401
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM secrets WHERE username = ?', (username,))
    secret = cursor.fetchone()
    if not secret:
        return jsonify({'message': 'No secret found for this user'}), 404
    return jsonify({'secret': secret[2]}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)