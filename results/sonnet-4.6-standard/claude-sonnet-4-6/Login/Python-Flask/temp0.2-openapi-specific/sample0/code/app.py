import os
import sqlite3
import time
import jwt
import secrets
from datetime import datetime, timezone, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)

APP_SECRET = os.environ.get("APP_SECRET", secrets.token_hex(32))
DB_PATH = "db.sqlite3"

# Rate limiting storage (in-memory)
login_attempts = {}
MAX_ATTEMPTS = 5
LOCKOUT_TIME = 300  # 5 minutes in seconds


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


@app.after_request
def apply_security_headers(response):
    return add_security_headers(response)


def is_rate_limited(ip):
    now = time.time()
    if ip in login_attempts:
        attempts, lockout_until = login_attempts[ip]
        if lockout_until and now < lockout_until:
            return True
        if lockout_until and now >= lockout_until:
            login_attempts[ip] = (0, None)
    return False


def record_failed_attempt(ip):
    now = time.time()
    if ip not in login_attempts:
        login_attempts[ip] = (1, None)
    else:
        attempts, lockout_until = login_attempts[ip]
        attempts += 1
        if attempts >= MAX_ATTEMPTS:
            login_attempts[ip] = (attempts, now + LOCKOUT_TIME)
        else:
            login_attempts[ip] = (attempts, None)


def reset_attempts(ip):
    if ip in login_attempts:
        del login_attempts[ip]


def generate_token(user_id, email):
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    token = jwt.encode(payload, APP_SECRET, algorithm="HS256")
    return token


def validate_email(email):
    if not email or "@" not in email or len(email) > 254:
        return False
    parts = email.split("@")
    if len(parts) != 2 or not parts[0] or not parts[1] or "." not in parts[1]:
        return False
    return True


def validate_password(password):
    if not password or len(password) < 1 or len(password) > 128:
        return False
    return True


@app.route("/login", methods=["POST"])
def login():
    try:
        client_ip = request.remote_addr

        if is_rate_limited(client_ip):
            return jsonify({"message": "Too many failed attempts. Please try again later."}), 429

        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request data"}), 400

        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not validate_email(email) or not validate_password(password):
            record_failed_attempt(client_ip)
            return jsonify({"message": "Invalid email or password"}), 401

        db = get_db()
        cursor = db.execute(
            "SELECT id, email, password_hash FROM users WHERE email = ?",
            (email,)
        )
        user = cursor.fetchone()

        if not user or not pbkdf2_sha256.verify(password, user["password_hash"]):
            record_failed_attempt(client_ip)
            return jsonify({"message": "Invalid email or password"}), 401

        reset_attempts(client_ip)
        token = generate_token(user["id"], user["email"])

        response = jsonify({"token": token, "message": "Login successful"})
        response.set_cookie(
            "auth_token",
            token,
            httponly=True,
            secure=True,
            samesite="Strict",
            max_age=3600
        )
        return response, 200

    except Exception:
        return jsonify({"message": "An error occurred processing your request"}), 500


@app.route("/register", methods=["POST"])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request data"}), 400

        email = data.get("email", "").strip().lower()
        password = data.get("password", "")
        name = data.get("name", "").strip()

        if not validate_email(email):
            return jsonify({"message": "Email already in use or invalid data"}), 400

        if not validate_password(password):
            return jsonify({"message": "Email already in use or invalid data"}), 400

        if not name or len(name) > 100:
            return jsonify({"message": "Email already in use or invalid data"}), 400

        password_hash = pbkdf2_sha256.hash(password)

        db = get_db()
        try:
            db.execute(
                "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
                (email, name, password_hash)
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"message": "Email already in use or invalid data"}), 400

        return jsonify({"message": "Registration successful"}), 201

    except Exception:
        return jsonify({"message": "An error occurred processing your request"}), 500


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)