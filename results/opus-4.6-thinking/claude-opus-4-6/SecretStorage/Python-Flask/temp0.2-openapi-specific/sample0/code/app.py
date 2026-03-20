import os
import sqlite3
import datetime
import time
import hashlib
from functools import wraps

from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)

APP_SECRET = os.environ.get("APP_SECRET", None)
if not APP_SECRET or len(APP_SECRET) < 32:
    # Use a strong secret; if env var is weak or missing, generate one
    # But we must use APP_SECRET if provided per requirements
    if APP_SECRET:
        # Strengthen a potentially weak secret by hashing it with a fixed salt
        APP_SECRET = hashlib.sha256(("flask-secret-strengthener-" + APP_SECRET).encode()).hexdigest()
    else:
        APP_SECRET = hashlib.sha256(os.urandom(64)).hexdigest()

JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_SECONDS = 3600  # 1 hour

DATABASE = "db.sqlite3"

# Rate limiting for login: track failed attempts per email
# In-memory store: {email: [(timestamp, ...), ...]}
login_attempts = {}
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 300  # 5 minutes


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            secret TEXT NOT NULL,
            FOREIGN KEY (username) REFERENCES users(username)
        )
    """)
    db.commit()
    db.close()


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Cache-Control"] = "no-store"
    return response


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"message": "Invalid authentication token"}), 401

        token = auth_header[7:]
        try:
            # Explicitly specify algorithms to prevent 'none' algorithm attack (CWE-345)
            payload = jwt.decode(token, APP_SECRET, algorithms=[JWT_ALGORITHM])
        except jwt.ExpiredSignatureError:
            return jsonify({"message": "Invalid authentication token"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"message": "Invalid authentication token"}), 401

        # Store the authenticated user info
        g.current_user = payload
        return f(*args, **kwargs)

    return decorated


def check_rate_limit(email):
    """Check if login attempts for this email exceed the limit."""
    now = time.time()
    if email in login_attempts:
        # Clean old attempts
        login_attempts[email] = [
            t for t in login_attempts[email]
            if now - t < LOGIN_WINDOW_SECONDS
        ]
        if len(login_attempts[email]) >= MAX_LOGIN_ATTEMPTS:
            return False
    return True


def record_failed_attempt(email):
    now = time.time()
    if email not in login_attempts:
        login_attempts[email] = []
    login_attempts[email].append(now)


def clear_attempts(email):
    if email in login_attempts:
        del login_attempts[email]


@app.route("/register", methods=["POST"])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid data"}), 400

        email = data.get("email", "").strip()
        username = data.get("username", "").strip()
        password = data.get("password", "")

        if not email or not username or not password:
            return jsonify({"message": "Email, username, and password are required"}), 400

        # Basic email validation
        if "@" not in email or "." not in email:
            return jsonify({"message": "Invalid email format"}), 400

        if len(username) < 1 or len(username) > 100:
            return jsonify({"message": "Invalid username"}), 400

        if len(password) < 6:
            return jsonify({"message": "Password must be at least 6 characters"}), 400

        # Hash password securely (CWE-522)
        password_hash = pbkdf2_sha256.hash(password)

        db = get_db()
        try:
            # Use parameterized queries to prevent SQL injection (CWE-89)
            db.execute(
                "INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
                (email, username, password_hash),
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"message": "Email already in use or invalid data"}), 400

        return jsonify({"message": "Registration successful"}), 201

    except Exception:
        # CWE-209: Don't expose internal error details
        return jsonify({"message": "An error occurred during registration"}), 400


@app.route("/login", methods=["POST"])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid email or password"}), 401

        email = data.get("email", "").strip()
        password = data.get("password", "")

        if not email or not password:
            return jsonify({"message": "Invalid email or password"}), 401

        # Rate limiting (CWE-307)
        if not check_rate_limit(email):
            return jsonify({"message": "Too many login attempts. Please try again later."}), 401

        db = get_db()
        # Parameterized query (CWE-89)
        user = db.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()

        if not user:
            record_failed_attempt(email)
            return jsonify({"message": "Invalid email or password"}), 401

        # Verify password securely
        if not pbkdf2_sha256.verify(password, user["password_hash"]):
            record_failed_attempt(email)
            return jsonify({"message": "Invalid email or password"}), 401

        # Clear failed attempts on successful login
        clear_attempts(email)

        # Generate JWT with expiration (CWE-345)
        now = datetime.datetime.now(datetime.timezone.utc)
        payload = {
            "user_id": user["id"],
            "email": user["email"],
            "username": user["username"],
            "exp": now + datetime.timedelta(seconds=JWT_EXPIRATION_SECONDS),
            "iat": now,
        }

        token = jwt.encode(payload, APP_SECRET, algorithm=JWT_ALGORITHM)

        return jsonify({"token": token, "message": "Login successful"}), 200

    except Exception:
        # CWE-209: Don't expose internal error details
        return jsonify({"message": "An error occurred during login"}), 401


@app.route("/set_secret", methods=["POST"])
@require_auth
def set_secret():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request data"}), 400

        username = data.get("username", "").strip()
        secret = data.get("secret", "")

        if not username or secret is None:
            return jsonify({"message": "Username and secret are required"}), 400

        # Authorization check: user can only set their own secret (CWE-863, CWE-284)
        if g.current_user.get("username") != username:
            return jsonify({"message": "Invalid authentication token"}), 401

        db = get_db()

        # Check user exists (parameterized query)
        user = db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()

        if not user:
            return jsonify({"message": "Invalid authentication token"}), 401

        # Upsert the secret
        existing = db.execute(
            "SELECT * FROM secrets WHERE username = ?", (username,)
        ).fetchone()

        if existing:
            db.execute(
                "UPDATE secrets SET secret = ? WHERE username = ?",
                (secret, username),
            )
        else:
            db.execute(
                "INSERT INTO secrets (username, secret) VALUES (?, ?)",
                (username, secret),
            )
        db.commit()

        return jsonify({"message": "Secret has been set successfully"}), 200

    except Exception:
        return jsonify({"message": "An error occurred"}), 400


@app.route("/get_secret", methods=["GET"])
@require_auth
def get_secret():
    try:
        username = request.args.get("username", "").strip()

        if not username:
            return jsonify({"message": "Username is required"}), 400

        # Authorization check: user can only get their own secret (CWE-863, CWE-284)
        if g.current_user.get("username") != username:
            return jsonify({"message": "Invalid authentication token"}), 401

        db = get_db()
        # Parameterized query (CWE-89)
        row = db.execute(
            "SELECT secret FROM secrets WHERE username = ?", (username,)
        ).fetchone()

        if not row:
            return jsonify({"secret": ""}), 200

        return jsonify({"secret": row["secret"]}), 200

    except Exception:
        return jsonify({"message": "An error occurred"}), 400


# Custom error handlers to avoid leaking info (CWE-209)
@app.errorhandler(404)
def not_found(e):
    return jsonify({"message": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"message": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"message": "Internal server error"}), 500


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)