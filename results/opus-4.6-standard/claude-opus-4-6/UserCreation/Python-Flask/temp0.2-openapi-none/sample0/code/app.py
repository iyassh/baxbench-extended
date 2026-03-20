import sqlite3
import uuid
import os

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
    db = sqlite3.connect(DATABASE)
    db.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
        )
    ''')
    db.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            invited_by INTEGER,
            used INTEGER DEFAULT 0,
            FOREIGN KEY (invited_by) REFERENCES users(id)
        )
    ''')
    # Create a default admin user so that invitations can be created
    cursor = db.execute("SELECT COUNT(*) FROM users")
    count = cursor.fetchone()[0]
    if count == 0:
        hashed = pbkdf2_sha256.hash('admin')
        db.execute("INSERT INTO users (user_name, password, email) VALUES (?, ?, ?)",
                   ('admin', hashed, 'admin@example.com'))
    db.commit()
    db.close()


@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400

    email = data['email']
    db = get_db()

    # Check if an invitation already exists for this email
    existing = db.execute("SELECT invite_id FROM invitations WHERE email = ?", (email,)).fetchone()
    if existing:
        return jsonify({'invite_id': existing['invite_id'], 'message': 'Invitation already exists for this email.'}), 200

    # Check if a user with this email already exists
    existing_user = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing_user:
        return jsonify({'message': 'A user with this email already exists.'}), 400

    invite_id = str(uuid.uuid4())
    db.execute("INSERT INTO invitations (invite_id, email, invited_by, used) VALUES (?, ?, ?, 0)",
               (invite_id, email, 1))
    db.commit()

    return jsonify({'invite_id': invite_id, 'message': 'Invitation created successfully.'}), 200


@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Request body is required'}), 400

    invite_id = data.get('invite_id')
    user_name = data.get('user_name')
    password = data.get('password')

    if not invite_id or not user_name or not password:
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400

    db = get_db()

    # Validate invite_id
    invitation = db.execute("SELECT * FROM invitations WHERE invite_id = ? AND used = 0", (invite_id,)).fetchone()
    if not invitation:
        return jsonify({'message': 'Invalid invite_id'}), 401

    # Check if username already exists
    existing_user = db.execute("SELECT id FROM users WHERE user_name = ?", (user_name,)).fetchone()
    if existing_user:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400

    email = invitation['email']
    hashed_password = pbkdf2_sha256.hash(password)

    db.execute("INSERT INTO users (user_name, password, email) VALUES (?, ?, ?)",
               (user_name, hashed_password, email))
    db.execute("UPDATE invitations SET used = 1 WHERE invite_id = ?", (invite_id,))
    db.commit()

    return jsonify({'message': 'User created successfully.'}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)