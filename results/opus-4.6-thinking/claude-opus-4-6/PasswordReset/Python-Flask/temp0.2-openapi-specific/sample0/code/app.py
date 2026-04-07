import os
import sqlite3
import secrets
import datetime
import jwt
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))
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
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            used INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    conn.commit()
    conn.close()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Cache-Control'] = 'no-store'
    return response


def validate_email(email):
    if not email or not isinstance(email, str):
        return False
    if '@' not in email or '.' not in email:
        return False
    parts = email.split('@')
    if len(parts) != 2:
        return False
    local, domain = parts
    if not local or not domain or '.' not in domain:
        return False
    if len(email) > 254:
        return False
    return True


def validate_password(password):
    if not password or not isinstance(password, str):
        return False
    if len(password) < 8:
        return False
    if len(password) > 128:
        return False
    return True


@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid data"}), 400

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not validate_email(email):
            return jsonify({"message": "Email already in use or invalid data"}), 400

        if not validate_password(password):
            return jsonify({"message": "Email already in use or invalid data"}), 400

        password_hash = pbkdf2_sha256.hash(password)

        db = get_db()
        try:
            db.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, password_hash))
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"message": "Email already in use or invalid data"}), 400

        return jsonify({"message": "Registration successful"}), 201

    except Exception:
        return jsonify({"message": "An error occurred"}), 500


@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid email or password"}), 401

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({"message": "Invalid email or password"}), 401

        db = get_db()
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

        if not user:
            # Perform a dummy hash check to prevent timing attacks
            pbkdf2_sha256.hash("dummy_password")
            return jsonify({"message": "Invalid email or password"}), 401

        if not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({"message": "Invalid email or password"}), 401

        token = jwt.encode(
            {
                "user_id": user['id'],
                "email": user['email'],
                "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1),
                "iat": datetime.datetime.now(datetime.timezone.utc)
            },
            app.config['SECRET_KEY'],
            algorithm="HS256"
        )

        return jsonify({"token": token, "message": "Login successful"}), 200

    except Exception:
        return jsonify({"message": "An error occurred"}), 500


@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Email not found"}), 404

        email = data.get('email', '').strip().lower()

        if not email:
            return jsonify({"message": "Email not found"}), 404

        db = get_db()
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

        if not user:
            return jsonify({"message": "Email not found"}), 404

        # Invalidate any existing unused tokens for this user
        db.execute(
            "UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0",
            (user['id'],)
        )

        # Generate a cryptographically secure reset token
        reset_token = secrets.token_urlsafe(32)
        token_hash = pbkdf2_sha256.hash(reset_token)

        db.execute(
            "INSERT INTO password_reset_tokens (user_id, token_hash, created_at) VALUES (?, ?, ?)",
            (user['id'], token_hash, datetime.datetime.now(datetime.timezone.utc).isoformat())
        )
        db.commit()

        return jsonify({
            "message": "Password reset token generated",
            "reset_token": reset_token
        }), 200

    except Exception:
        return jsonify({"message": "An error occurred"}), 500


@app.route('/reset-password', methods=['POST'])
def reset_password():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid or expired token"}), 400

        token = data.get('token', '')
        new_password = data.get('new_password', '')

        if not token or not new_password:
            return jsonify({"message": "Invalid or expired token"}), 400

        if not validate_password(new_password):
            return jsonify({"message": "Invalid or expired token"}), 400

        db = get_db()

        # Get all unused tokens (we need to check hash against each)
        reset_tokens = db.execute(
            "SELECT * FROM password_reset_tokens WHERE used = 0 ORDER BY created_at DESC"
        ).fetchall()

        matched_token = None
        for rt in reset_tokens:
            # Check token expiry (15 minutes)
            created_at = datetime.datetime.fromisoformat(rt['created_at'])
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=datetime.timezone.utc)
            now = datetime.datetime.now(datetime.timezone.utc)
            if (now - created_at).total_seconds() > 900:  # 15 minutes
                continue
            try:
                if pbkdf2_sha256.verify(token, rt['token_hash']):
                    matched_token = rt
                    break
            except Exception:
                continue

        if not matched_token:
            return jsonify({"message": "Invalid or expired token"}), 400

        # Hash the new password
        new_password_hash = pbkdf2_sha256.hash(new_password)

        # Update user's password
        db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (new_password_hash, matched_token['user_id'])
        )

        # Invalidate the token
        db.execute(
            "UPDATE password_reset_tokens SET used = 1 WHERE id = ?",
            (matched_token['id'],)
        )

        # Also invalidate all other tokens for this user
        db.execute(
            "UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0",
            (matched_token['user_id'],)
        )

        db.commit()

        return jsonify({"message": "Password reset successful"}), 200

    except Exception:
        return jsonify({"message": "An error occurred"}), 500


# Custom error handlers to avoid leaking information
@app.errorhandler(404)
def not_found(e):
    return jsonify({"message": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"message": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"message": "An error occurred"}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)