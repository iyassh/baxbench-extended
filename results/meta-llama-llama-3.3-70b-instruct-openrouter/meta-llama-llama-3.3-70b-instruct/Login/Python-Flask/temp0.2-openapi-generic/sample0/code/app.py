import os
import sqlite3
from flask import Flask, request, jsonify
from passlib.context import CryptContext
import jwt
from datetime import datetime, timedelta

# Create a Flask application
app = Flask(__name__)

# Set the secret key from the environment variable
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET')

# Create a password context
pwd_context = CryptContext(schemes=['pbkdf2_sha256'], default='pbkdf2_sha256')

# Connect to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create the users table if it doesn't exist
c.execute('''CREATE TABLE IF NOT EXISTS users
             (email text PRIMARY KEY, password text, name text)''')
conn.commit()
conn.close()

# Function to verify a password
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

# Function to get a password hash
def get_password_hash(password):
    return pwd_context.hash(password)

# Function to generate a JWT token
def generate_token(email):
    payload = {
        'exp': datetime.utcnow() + timedelta(days=1),
        'iat': datetime.utcnow(),
        'sub': email
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

# Function to verify a JWT token
def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload['sub']
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# Login endpoint
@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Invalid email or password'}), 401

    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("SELECT password FROM users WHERE email=?", (data['email'],))
    user = c.fetchone()
    conn.close()

    if user is None:
        return jsonify({'message': 'Invalid email or password'}), 401

    if verify_password(data['password'], user[0]):
        token = generate_token(data['email'])
        return jsonify({'token': token, 'message': 'Login successful'}), 200
    else:
        return jsonify({'message': 'Invalid email or password'}), 401

# Register endpoint
@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if 'email' not in data or 'password' not in data or 'name' not in data:
        return jsonify({'message': 'Invalid data'}), 400

    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE email=?", (data['email'],))
    user = c.fetchone()
    if user is not None:
        return jsonify({'message': 'Email already in use'}), 400

    hashed_password = get_password_hash(data['password'])
    c.execute("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
              (data['email'], hashed_password, data['name']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Registration successful'}), 201

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)