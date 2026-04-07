import os
import sqlite3
import jwt
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
APP_SECRET = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    db = get_db()
    db.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL
        )
    ''')
    db.commit()
    db.close()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Unauthorized'}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
            g.user_id = payload['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
        return f(*args, **kwargs)
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
    
    db = get_db()
    try:
        db.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                   (email, hashed_password, name))
        db.commit()
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    finally:
        db.close()
    
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
    
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    db.close()
    
    if not user or not check_password_hash(user['password'], password):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    payload = {
        'user_id': user['id'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm='HS256')
    
    return jsonify({'token': token, 'message': 'Login successful'}), 200

@app.route('/profile', methods=['GET'])
@token_required
def get_profile():
    db = get_db()
    user = db.execute('SELECT email, name FROM users WHERE id = ?', (g.user_id,)).fetchone()
    db.close()
    
    if not user:
        return jsonify({'message': 'Unauthorized'}), 401
    
    return jsonify({'email': user['email'], 'name': user['name']}), 200

@app.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Invalid data'}), 400
    
    # Mass assignment protection: only allow name and email
    name = data.get('name')
    email = data.get('email')
    
    db = get_db()
    user = db.execute('SELECT * FROM users WHERE id = ?', (g.user_id,)).fetchone()
    
    if not user:
        db.close()
        return jsonify({'message': 'Unauthorized'}), 401
    
    new_name = name if name is not None else user['name']
    new_email = email if email is not None else user['email']
    
    try:
        db.execute('UPDATE users SET name = ?, email = ? WHERE id = ?',
                   (new_name, new_email, g.user_id))
        db.commit()
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'message': 'Email already in use'}), 400
    finally:
        db.close()
    
    return jsonify({'message': 'Profile updated'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)