import os
import sqlite3
import uuid
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DB_NAME = 'db.sqlite3'


def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            used INTEGER NOT NULL DEFAULT 0
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            email TEXT
        )
    ''')
    conn.commit()
    conn.close()


@app.route('/invite_user', methods=['POST'])
def invite_user():
    data = request.get_json()
    if not data or 'email' not in data:
        return jsonify({'message': 'Email is required'}), 400

    email = data['email'].strip().lower()

    conn = get_db()
    cursor = conn.cursor()

    # Check if invitation already exists for this email
    cursor.execute('SELECT invite_id FROM invitations WHERE email = ?', (email,))
    existing = cursor.fetchone()

    if existing:
        invite_id = existing['invite_id']
        conn.close()
        return jsonify({
            'invite_id': invite_id,
            'message': f'Invitation already exists for {email}'
        }), 200

    # Create new invitation
    invite_id = str(uuid.uuid4())
    cursor.execute(
        'INSERT INTO invitations (invite_id, email) VALUES (?, ?)',
        (invite_id, email)
    )
    conn.commit()
    conn.close()

    return jsonify({
        'invite_id': invite_id,
        'message': f'Invitation created for {email}'
    }), 200


@app.route('/create_user', methods=['POST'])
def create_user():
    data = request.get_json()
    if not data:
        return jsonify({'message': 'Request body is required'}), 400

    invite_id = data.get('invite_id', '').strip()
    user_name = data.get('user_name', '').strip()
    password = data.get('password', '')

    if not invite_id or not user_name or not password:
        return jsonify({'message': 'invite_id, user_name, and password are required'}), 400

    conn = get_db()
    cursor = conn.cursor()

    # Validate invite_id
    cursor.execute('SELECT * FROM invitations WHERE invite_id = ?', (invite_id,))
    invitation = cursor.fetchone()

    if not invitation:
        conn.close()
        return jsonify({'message': 'Invalid invite_id'}), 401

    if invitation['used']:
        conn.close()
        return jsonify({'message': 'Invalid invite_id'}), 401

    # Check if username already exists
    cursor.execute('SELECT id FROM users WHERE user_name = ?', (user_name,))
    existing_user = cursor.fetchone()

    if existing_user:
        conn.close()
        return jsonify({'message': 'Username already exists. Try providing different username.'}), 400

    # Create user
    password_hash = generate_password_hash(password)
    email = invitation['email']

    cursor.execute(
        'INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)',
        (user_name, password_hash, email)
    )

    # Mark invitation as used
    cursor.execute(
        'UPDATE invitations SET used = 1 WHERE invite_id = ?',
        (invite_id,)
    )

    conn.commit()
    conn.close()

    return jsonify({'message': f'User {user_name} created successfully'}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)