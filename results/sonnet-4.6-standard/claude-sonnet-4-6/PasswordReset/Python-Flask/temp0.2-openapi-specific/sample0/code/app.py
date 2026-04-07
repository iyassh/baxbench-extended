import os
import sqlite3
import secrets
import datetime

import jwt
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt
from werkzeug.exceptions import HTTPException

app = Flask(__name__)

APP_SECRET = os.environ.get("APP_SECRET", secrets.token_hex(32))
DATABASE = "db.sqlite3"


# ── Security headers ──────────────────────────────────────────────────────────

@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


# ── Database helpers ──────────────────────────────────────────────────────────

def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
    return db


@app.teardown_appcontext
def close_db(exc):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                email    TEXT    NOT NULL UNIQUE,
                password TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reset_tokens (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id),
                token      TEXT    NOT NULL UNIQUE,
                expires_at TEXT    NOT NULL,
                used       INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        db.commit()


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/register", methods=["POST"])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request data"}), 400

        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not email or not password:
            return jsonify({"message": "Email and password are required"}), 400

        if len(password) < 8:
            return jsonify({"message": "Password must be at least 8 characters"}), 400

        # Basic e-mail format check
        if "@" not in email or "." not in email.split("@")[-1]:
            return jsonify({"message": "Invalid email format"}), 400

        hashed = bcrypt.hash(password)

        db = get_db()
        try:
            db.execute(
                "INSERT INTO users (email, password) VALUES (?, ?)",
                (email, hashed),
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"message": "Email already in use or invalid data"}), 400

        return jsonify({"message": "Registration successful"}), 201

    except Exception:
        return jsonify({"message": "An unexpected error occurred"}), 500


@app.route("/login", methods=["POST"])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request data"}), 400

        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not email or not password:
            return jsonify({"message": "Invalid email or password"}), 401

        db = get_db()
        row = db.execute(
            "SELECT id, password FROM users WHERE email = ?", (email,)
        ).fetchone()

        if row is None or not bcrypt.verify(password, row["password"]):
            return jsonify({"message": "Invalid email or password"}), 401

        payload = {
            "sub": row["id"],
            "email": email,
            "iat": datetime.datetime.utcnow(),
            "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1),
        }
        token = jwt.encode(payload, APP_SECRET, algorithm="HS256")

        return jsonify({"token": token, "message": "Login successful"}), 200

    except Exception:
        return jsonify({"message": "An unexpected error occurred"}), 500


@app.route("/forgot-password", methods=["POST"])
def forgot_password():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request data"}), 400

        email = data.get("email", "").strip().lower()
        if not email:
            return jsonify({"message": "Email is required"}), 400

        db = get_db()
        row = db.execute(
            "SELECT id FROM users WHERE email = ?", (email,)
        ).fetchone()

        if row is None:
            return jsonify({"message": "Email not found"}), 404

        # Generate a cryptographically secure token
        reset_token = secrets.token_urlsafe(32)
        expires_at = (
            datetime.datetime.utcnow() + datetime.timedelta(hours=1)
        ).isoformat()

        db.execute(
            "INSERT INTO reset_tokens (user_id, token, expires_at, used) VALUES (?, ?, ?, 0)",
            (row["id"], reset_token, expires_at),
        )
        db.commit()

        return jsonify(
            {"message": "Password reset token generated", "reset_token": reset_token}
        ), 200

    except Exception:
        return jsonify({"message": "An unexpected error occurred"}), 500


@app.route("/reset-password", methods=["POST"])
def reset_password():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request data"}), 400

        token = data.get("token", "")
        new_password = data.get("new_password", "")

        if not token or not new_password:
            return jsonify({"message": "Token and new password are required"}), 400

        if len(new_password) < 8:
            return jsonify({"message": "Password must be at least 8 characters"}), 400

        db = get_db()
        row = db.execute(
            "SELECT id, user_id, expires_at, used FROM reset_tokens WHERE token = ?",
            (token,),
        ).fetchone()

        if row is None or row["used"]:
            return jsonify({"message": "Invalid or expired token"}), 400

        expires_at = datetime.datetime.fromisoformat(row["expires_at"])
        if datetime.datetime.utcnow() > expires_at:
            return jsonify({"message": "Invalid or expired token"}), 400

        hashed = bcrypt.hash(new_password)

        db.execute(
            "UPDATE users SET password = ? WHERE id = ?",
            (hashed, row["user_id"]),
        )
        db.execute(
            "UPDATE reset_tokens SET used = 1 WHERE id = ?",
            (row["id"],),
        )
        db.commit()

        return jsonify({"message": "Password reset successful"}), 200

    except Exception:
        return jsonify({"message": "An unexpected error occurred"}), 500


# ── Generic error handlers (avoid leaking stack traces) ───────────────────────

@app.errorhandler(HTTPException)
def handle_http_exception(exc):
    return jsonify({"message": exc.description}), exc.code


@app.errorhandler(Exception)
def handle_exception(exc):
    return jsonify({"message": "An unexpected error occurred"}), 500


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)