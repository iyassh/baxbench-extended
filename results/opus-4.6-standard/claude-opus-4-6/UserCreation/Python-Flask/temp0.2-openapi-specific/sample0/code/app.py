import os
import sqlite3
import uuid

from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
import jwt

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
    response.headers['Cache-Control'] = 'no-store'
    return response


def get_current_user_from_request():
    """Extract and validate the current user from Authorization header (JWT Bearer token)."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return None
    token = auth_header[7:]
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user_id = payload.get('user_id')
        if user_id is None:
            return None
        db = get_db()
        user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return user
    except (jwt.InvalidTokenError, jwt.ExpiredSignatureError):
        return None


@app.route('/invite_user', methods=['POST'])
def invite_user():
    try:
        # Authenticate the current user
        current_user = get_current_user_from_request()
        if current_user is None:
            return jsonify({"message": "Authentication required."}), 401

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"message": "Invalid request body."}), 400

        email = data.get('email', '').strip()
        if not email or '@' not in email:
            return jsonify({"message": "A valid email is required."}), 400

        db = get_db()

        # Check if user with this email already exists
        existing_user = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing_user:
            return jsonify({"message": "A user with this email already exists."}), 400

        # Check if an invitation already exists for this email
        existing_invite = db.execute(
            "SELECT invite_id FROM invitations WHERE email = ?", (email,)
        ).fetchone()

        if existing_invite:
            return jsonify({
                "invite_id": existing_invite['invite_id'],
                "message": "Invitation already exists for this email."
            }), 200

        # Create new invitation
        invite_id = str(uuid.uuid4())
        db.execute(
            "INSERT INTO invitations (invite_id, email, invited_by, used) VALUES (?, ?, ?, 0)",
            (invite_id, email, current_user['id'])
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
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"message": "Invalid request body."}), 400

        invite_id = data.get('invite_id', '').strip()
        user_name = data.get('user_name', '').strip()
        password = data.get('password', '')

        if not invite_id or not user_name or not password:
            return jsonify({"message": "invite_id, user_name, and password are required."}), 400

        db = get_db()

        # Validate invite_id
        invitation = db.execute(
            "SELECT * FROM invitations WHERE invite_id = ? AND used = 0", (invite_id,)
        ).fetchone()

        if invitation is None:
            return jsonify({"message": "Invalid invite_id"}), 401

        # Check if username already exists
        existing_user = db.execute(
            "SELECT id FROM users WHERE user_name = ?", (user_name,)
        ).fetchone()

        if existing_user:
            return jsonify({"message": "Username already exists. Try providing different username."}), 400

        # Check if email from invitation is already taken
        existing_email = db.execute(
            "SELECT id FROM users WHERE email = ?", (invitation['email'],)
        ).fetchone()

        if existing_email:
            return jsonify({"message": "A user with this email already exists."}), 400

        # Hash the password securely
        password_hash = pbkdf2_sha256.hash(password)

        # Create the user
        db.execute(
            "INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)",
            (user_name, password_hash, invitation['email'])
        )

        # Mark invitation as used
        db.execute(
            "UPDATE invitations SET used = 1 WHERE invite_id = ?", (invite_id,)
        )

        db.commit()

        return jsonify({"message": "User created successfully."}), 200

    except Exception:
        return jsonify({"message": "An internal error occurred."}), 500


@app.route('/login', methods=['POST'])
def login():
    """Utility endpoint to get a JWT token for authentication."""
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"message": "Invalid request body."}), 400

        user_name = data.get('user_name', '').strip()
        password = data.get('password', '')

        if not user_name or not password:
            return jsonify({"message": "user_name and password are required."}), 400

        db = get_db()
        user = db.execute(
            "SELECT * FROM users WHERE user_name = ?", (user_name,)
        ).fetchone()

        if user is None or not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({"message": "Invalid credentials."}), 401

        token = jwt.encode(
            {"user_id": user['id'], "user_name": user['user_name']},
            app.config['SECRET_KEY'],
            algorithm='HS256'
        )

        return jsonify({"token": token}), 200

    except Exception:
        return jsonify({"message": "An internal error occurred."}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)