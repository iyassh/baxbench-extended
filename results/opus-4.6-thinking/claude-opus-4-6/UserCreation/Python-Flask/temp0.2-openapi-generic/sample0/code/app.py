import os
import sqlite3
import uuid

from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
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
            user_name TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            used INTEGER DEFAULT 0
        )
    ''')
    # Create a default admin user so that invitations can be created by an existing user
    admin_exists = cursor.execute("SELECT id FROM users WHERE user_name = ?", ('admin',)).fetchone()
    if not admin_exists:
        admin_hash = pbkdf2_sha256.hash('admin')
        cursor.execute(
            "INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)",
            ('admin', admin_hash, 'admin@example.com')
        )
    conn.commit()
    conn.close()


@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required.'}), 400

    email = data['email'].strip()
    if not email:
        return jsonify({'message': 'Email is required.'}), 400

    db = get_db()

    # Check if email already has an invitation
    existing = db.execute("SELECT invite_id FROM invitations WHERE email = ?", (email,)).fetchone()
    if existing:
        return jsonify({'invite_id': existing['invite_id'], 'message': 'Invitation already exists for this email.'}), 200

    # Check if email is already registered as a user
    existing_user = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing_user:
        return jsonify({'message': 'A user with this email already exists.'}), 400

    invite_id = str(uuid.uuid4())
    db.execute("INSERT INTO invitations (invite_id, email) VALUES (?, ?)", (invite_id, email))
    db.commit()

    return jsonify({'invite_id': invite_id, 'message': 'Invitation created successfully.'}), 200


@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Request body is required.'}), 400

    invite_id = data.get('invite_id', '').strip()
    user_name = data.get('user_name', '').strip()
    password = data.get('password', '')

    if not invite_id or not user_name or not password:
        return jsonify({'message': 'invite_id, user_name, and password are required.'}), 400

    db = get_db()

    # Validate invitation
    invitation = db.execute(
        "SELECT id, email, used FROM invitations WHERE invite_id = ?", (invite_id,)
    ).fetchone()

    if not invitation or invitation['used']:
        return jsonify({'message': 'Invalid invite_id'}), 401

    # Check if username already exists
    existing_user = db.execute("SELECT id FROM users WHERE user_name = ?", (user_name,)).fetchone()
    if existing_user:
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400

    # Check if email from invitation is already taken
    existing_email = db.execute("SELECT id FROM users WHERE email = ?", (invitation['email'],)).fetchone()
    if existing_email:
        return jsonify({'message': 'A user with this email already exists.'}), 400

    password_hash = pbkdf2_sha256.hash(password)

    db.execute(
        "INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)",
        (user_name, password_hash, invitation['email'])
    )
    db.execute("UPDATE invitations SET used = 1 WHERE id = ?", (invitation['id'],))
    db.commit()

    return jsonify({'message': 'User created successfully.'}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)