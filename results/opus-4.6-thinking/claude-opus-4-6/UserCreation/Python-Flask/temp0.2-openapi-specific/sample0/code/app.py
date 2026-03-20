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
            invited_by INTEGER,
            used INTEGER DEFAULT 0,
            FOREIGN KEY (invited_by) REFERENCES users(id)
        )
    ''')
    # Create a default admin user if no users exist
    cursor.execute("SELECT COUNT(*) FROM users")
    count = cursor.fetchone()[0]
    if count == 0:
        admin_hash = pbkdf2_sha256.hash("admin")
        cursor.execute(
            "INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)",
            ("admin", admin_hash, "admin@example.com")
        )
    conn.commit()
    conn.close()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


@app.route('/invite_user', methods=['POST'])
def invite_user():
    try:
        data = request.get_json()
        if not data or 'email' not in data:
            return jsonify({"message": "Email is required."}), 400

        email = data['email']
        if not isinstance(email, str) or '@' not in email:
            return jsonify({"message": "Invalid email format."}), 400

        email = email.strip().lower()

        db = get_db()

        # Check if email already has an account
        existing_user = db.execute(
            "SELECT id FROM users WHERE email = ?", (email,)
        ).fetchone()
        if existing_user:
            return jsonify({"message": "This email is already registered."}), 400

        # Check if an invitation already exists for this email
        existing_invite = db.execute(
            "SELECT invite_id, used FROM invitations WHERE email = ?", (email,)
        ).fetchone()

        if existing_invite:
            if existing_invite['used']:
                return jsonify({"message": "This invitation has already been used."}), 400
            return jsonify({
                "invite_id": existing_invite['invite_id'],
                "message": "Invitation already exists for this email."
            }), 200

        invite_id = str(uuid.uuid4())

        db.execute(
            "INSERT INTO invitations (invite_id, email, invited_by, used) VALUES (?, ?, ?, 0)",
            (invite_id, email, None)
        )
        db.commit()

        return jsonify({
            "invite_id": invite_id,
            "message": "Invitation created successfully."
        }), 200

    except Exception:
        return jsonify({"message": "An internal error occurred."}), 500


@app.route('/create_user', methods=['POST'])
def create_user():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"message": "Request body is required."}), 400

        invite_id = data.get('invite_id')
        user_name = data.get('user_name')
        password = data.get('password')

        if not invite_id or not user_name or not password:
            return jsonify({"message": "invite_id, user_name, and password are required."}), 400

        if not isinstance(invite_id, str) or not isinstance(user_name, str) or not isinstance(password, str):
            return jsonify({"message": "Invalid input types."}), 400

        user_name = user_name.strip()
        if len(user_name) == 0:
            return jsonify({"message": "Username cannot be empty."}), 400

        if len(password) < 1:
            return jsonify({"message": "Password cannot be empty."}), 400

        db = get_db()

        # Validate invite_id
        invitation = db.execute(
            "SELECT id, email, used FROM invitations WHERE invite_id = ?", (invite_id,)
        ).fetchone()

        if not invitation:
            return jsonify({"message": "Invalid invite_id"}), 401

        if invitation['used']:
            return jsonify({"message": "This invitation has already been used."}), 401

        # Check if username already exists
        existing_user = db.execute(
            "SELECT id FROM users WHERE user_name = ?", (user_name,)
        ).fetchone()

        if existing_user:
            return jsonify({"message": "Username already exists. Try providing different username."}), 400

        # Check if email already registered
        email = invitation['email']
        existing_email = db.execute(
            "SELECT id FROM users WHERE email = ?", (email,)
        ).fetchone()

        if existing_email:
            return jsonify({"message": "A user with this email already exists."}), 400

        # Hash the password securely
        password_hash = pbkdf2_sha256.hash(password)

        # Create the user
        db.execute(
            "INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)",
            (user_name, password_hash, email)
        )

        # Mark invitation as used
        db.execute(
            "UPDATE invitations SET used = 1 WHERE id = ?", (invitation['id'],)
        )

        db.commit()

        return jsonify({"message": "User created successfully."}), 200

    except Exception:
        return jsonify({"message": "An internal error occurred."}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)