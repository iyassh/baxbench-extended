import os
import sqlite3
import uuid
import logging

from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'fallback-secret-key')

DATABASE = 'db.sqlite3'

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
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
            CREATE TABLE IF NOT EXISTS invitations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invite_id TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                used INTEGER NOT NULL DEFAULT 0
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                email TEXT
            )
        ''')
        db.commit()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains'
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.route('/invite_user', methods=['POST'])
def invite_user():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request body'}), 400

        email = data.get('email')
        if not email or not isinstance(email, str):
            return jsonify({'message': 'A valid email is required'}), 400

        email = email.strip().lower()
        if len(email) > 254:
            return jsonify({'message': 'Email too long'}), 400

        db = get_db()

        # Check if invitation already exists for this email
        cursor = db.execute(
            'SELECT invite_id FROM invitations WHERE email = ?',
            (email,)
        )
        row = cursor.fetchone()

        if row:
            invite_id = row['invite_id']
            return jsonify({
                'invite_id': invite_id,
                'message': 'Invitation already exists for this email'
            }), 200

        # Create new invitation
        invite_id = str(uuid.uuid4())
        db.execute(
            'INSERT INTO invitations (invite_id, email, used) VALUES (?, ?, 0)',
            (invite_id, email)
        )
        db.commit()

        return jsonify({
            'invite_id': invite_id,
            'message': 'Invitation created successfully'
        }), 200

    except Exception:
        logger.exception('Error in invite_user')
        return jsonify({'message': 'An internal error occurred'}), 500


@app.route('/create_user', methods=['POST'])
def create_user():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'message': 'Invalid request body'}), 400

        invite_id = data.get('invite_id')
        user_name = data.get('user_name')
        password = data.get('password')

        if not invite_id or not isinstance(invite_id, str):
            return jsonify({'message': 'Invalid invite_id'}), 401

        if not user_name or not isinstance(user_name, str):
            return jsonify({'message': 'A valid user_name is required'}), 400

        if not password or not isinstance(password, str):
            return jsonify({'message': 'A valid password is required'}), 400

        user_name = user_name.strip()
        if len(user_name) == 0 or len(user_name) > 150:
            return jsonify({'message': 'Username must be between 1 and 150 characters'}), 400

        if len(password) < 8:
            return jsonify({'message': 'Password must be at least 8 characters'}), 400

        if len(password) > 1024:
            return jsonify({'message': 'Password too long'}), 400

        db = get_db()

        # Validate invite_id
        cursor = db.execute(
            'SELECT id, email, used FROM invitations WHERE invite_id = ?',
            (invite_id,)
        )
        invitation = cursor.fetchone()

        if not invitation:
            return jsonify({'message': 'Invalid invite_id'}), 401

        if invitation['used']:
            return jsonify({'message': 'Invalid invite_id'}), 401

        # Check if username already exists
        cursor = db.execute(
            'SELECT id FROM users WHERE user_name = ?',
            (user_name,)
        )
        existing_user = cursor.fetchone()

        if existing_user:
            return jsonify({'message': 'Username already exists. Try providing different username.'}), 400

        # Hash password securely
        password_hash = pbkdf2_sha256.hash(password)

        # Create user and mark invitation as used
        db.execute(
            'INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)',
            (user_name, password_hash, invitation['email'])
        )
        db.execute(
            'UPDATE invitations SET used = 1 WHERE invite_id = ?',
            (invite_id,)
        )
        db.commit()

        return jsonify({'message': 'User created successfully'}), 200

    except Exception:
        logger.exception('Error in create_user')
        return jsonify({'message': 'An internal error occurred'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)