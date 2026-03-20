import os
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from functools import wraps

import jwt
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt
from werkzeug.exceptions import HTTPException

app = Flask(__name__)

APP_SECRET = os.environ.get("APP_SECRET", os.urandom(32).hex())

# Rate limiting storage (in-memory)
login_attempts = {}
MAX_ATTEMPTS = 5
LOCKOUT_DURATION = 300  # 5 minutes

DATABASE = "db.sqlite3"


def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS secrets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                secret TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        db.commit()


@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


def generate_token(user_id, username):
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    token = jwt.encode(payload, APP_SECRET, algorithm="HS256")
    return token


def verify_token(token):
    try:
        payload = jwt.decode(
            token,
            APP_SECRET,
            algorithms=["HS256"],
            options={"require": ["exp", "sub", "iat"]},
        )
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"message": "Invalid authentication token"}), 401
        token = auth_header[7:]
        payload = verify_token(token)
        if payload is None:
            return jsonify({"message": "Invalid authentication token"}), 401
        g.current_user = payload
        return f(*args, **kwargs)
    return decorated


def is_rate_limited(email):
    now = time.time()
    if email in login_attempts:
        attempts, lockout_until = login_attempts[email]
        if lockout_until and now < lockout_until:
            return True
        if now > lockout_until if lockout_until else True:
            # Clean up expired lockout
            if lockout_until and now >= lockout_until:
                login_attempts[email] = (0, None)
    return False


def record_failed_attempt(email):
    now = time.time()
    if email in login_attempts:
        attempts, lockout_until = login_attempts[email]
        if lockout_until and now >= lockout_until:
            attempts = 0
            lockout_until = None
        attempts += 1
        if attempts >= MAX_ATTEMPTS:
            lockout_until = now + LOCKOUT_DURATION
        login_attempts[email] = (attempts, lockout_until)
    else:
        login_attempts[email] = (1, None)


def reset_attempts(email):
    if email in login_attempts:
        del login_attempts[email]


@app.route("/register", methods=["POST"])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request data"}), 400

        email = data.get("email", "").strip().lower()
        username = data.get("username", "").strip()
        password = data.get("password", "")

        if not email or not username or not password:
            return jsonify({"message": "Email, username and password are required"}), 400

        if len(password) < 1:
            return jsonify({"message": "Password cannot be empty"}), 400

        if "@" not in email or "." not in email:
            return jsonify({"message": "Invalid email format"}), 400

        if len(username) < 1 or len(username) > 64:
            return jsonify({"message": "Invalid username"}), 400

        password_hash = bcrypt.hash(password)

        db = get_db()
        try:
            db.execute(
                "INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
                (email, username, password_hash),
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"message": "Email already in use or invalid data"}), 400

        return jsonify({"message": "Registration successful"}), 201

    except Exception:
        return jsonify({"message": "An error occurred during registration"}), 500


@app.route("/login", methods=["POST"])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request data"}), 400

        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not email or not password:
            return jsonify({"message": "Email and password are required"}), 400

        if is_rate_limited(email):
            return jsonify({"message": "Too many failed attempts. Please try again later."}), 429

        db = get_db()
        row = db.execute(
            "SELECT id, username, password_hash FROM users WHERE email = ?",
            (email,),
        ).fetchone()

        if row is None or not bcrypt.verify(password, row["password_hash"]):
            record_failed_attempt(email)
            return jsonify({"message": "Invalid email or password"}), 401

        reset_attempts(email)
        token = generate_token(row["id"], row["username"])
        return jsonify({"token": token, "message": "Login successful"}), 200

    except Exception:
        return jsonify({"message": "An error occurred during login"}), 500


@app.route("/set_secret", methods=["POST"])
@token_required
def set_secret():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request data"}), 400

        username = data.get("username", "").strip()
        secret = data.get("secret", "")

        if not username or secret is None:
            return jsonify({"message": "Username and secret are required"}), 400

        # Verify the token's username matches the requested username
        token_username = g.current_user.get("username")
        if token_username != username:
            return jsonify({"message": "Invalid authentication token"}), 401

        db = get_db()
        user_row = db.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()

        if user_row is None:
            return jsonify({"message": "Invalid authentication token"}), 401

        # Verify token's sub matches user id
        token_user_id = g.current_user.get("sub")
        if str(user_row["id"]) != str(token_user_id):
            return jsonify({"message": "Invalid authentication token"}), 401

        existing = db.execute(
            "SELECT id FROM secrets WHERE user_id = ?",
            (user_row["id"],),
        ).fetchone()

        if existing:
            db.execute(
                "UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                (secret, user_row["id"]),
            )
        else:
            db.execute(
                "INSERT INTO secrets (user_id, secret) VALUES (?, ?)",
                (user_row["id"], secret),
            )
        db.commit()

        return jsonify({"message": "Secret has been set successfully"}), 200

    except Exception:
        return jsonify({"message": "An error occurred"}), 500


@app.route("/get_secret", methods=["GET"])
@token_required
def get_secret():
    try:
        username = request.args.get("username", "").strip()

        if not username:
            return jsonify({"message": "Username is required"}), 400

        # Verify the token's username matches the requested username
        token_username = g.current_user.get("username")
        if token_username != username:
            return jsonify({"message": "Invalid authentication token"}), 401

        db = get_db()
        user_row = db.execute(
            "SELECT id FROM users WHERE username = ?",
            (username,),
        ).fetchone()

        if user_row is None:
            return jsonify({"message": "Invalid authentication token"}), 401

        # Verify token's sub matches user id
        token_user_id = g.current_user.get("sub")
        if str(user_row["id"]) != str(token_user_id):
            return jsonify({"message": "Invalid authentication token"}), 401

        secret_row = db.execute(
            "SELECT secret FROM secrets WHERE user_id = ?",
            (user_row["id"],),
        ).fetchone()

        if secret_row is None:
            return jsonify({"secret": ""}), 200

        return jsonify({"secret": secret_row["secret"]}), 200

    except Exception:
        return jsonify({"message": "An error occurred"}), 500


@app.errorhandler(HTTPException)
def handle_http_exception(e):
    return jsonify({"message": "An error occurred"}), e.code


@app.errorhandler(Exception)
def handle_exception(e):
    return jsonify({"message": "An internal error occurred"}), 500


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)
else:
    init_db()