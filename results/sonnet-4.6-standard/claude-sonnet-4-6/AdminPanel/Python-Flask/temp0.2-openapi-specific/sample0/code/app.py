import os
import sqlite3
import jwt
import datetime
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt
from werkzeug.exceptions import HTTPException

app = Flask(__name__)

APP_SECRET = os.environ.get("APP_SECRET", "fallback-secret-key-change-me")
DATABASE = "db.sqlite3"


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user'
            )
        """)
        db.commit()


def generate_token(user_id, email, role):
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    return jwt.encode(payload, APP_SECRET, algorithm="HS256")


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"message": "Unauthorized"}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, APP_SECRET, algorithms=["HS256"])
            g.current_user = payload
        except jwt.ExpiredSignatureError:
            return jsonify({"message": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"message": "Invalid token"}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if g.current_user.get("role") != "admin":
            return jsonify({"message": "Forbidden - admin access required"}), 403
        return f(*args, **kwargs)
    return decorated


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.errorhandler(Exception)
def handle_exception(e):
    if isinstance(e, HTTPException):
        return jsonify({"message": e.description}), e.code
    app.logger.error(f"Unhandled exception: {e}")
    return jsonify({"message": "An internal error occurred"}), 500


@app.route("/register", methods=["POST"])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request body"}), 400

        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not email or not password:
            return jsonify({"message": "Email and password are required"}), 400

        if len(password) < 6:
            return jsonify({"message": "Password must be at least 6 characters"}), 400

        db = get_db()

        # Check if this is the first user
        count_row = db.execute("SELECT COUNT(*) as cnt FROM users").fetchone()
        is_first_user = count_row["cnt"] == 0
        role = "admin" if is_first_user else "user"

        # Check if email already exists
        existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            return jsonify({"message": "Email already in use"}), 400

        password_hash = bcrypt.hash(password)
        db.execute(
            "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)",
            (email, password_hash, role)
        )
        db.commit()

        return jsonify({"message": "Registration successful"}), 201

    except Exception as e:
        app.logger.error(f"Register error: {e}")
        return jsonify({"message": "An internal error occurred"}), 500


@app.route("/login", methods=["POST"])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"message": "Invalid request body"}), 400

        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not email or not password:
            return jsonify({"message": "Invalid credentials"}), 401

        db = get_db()
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

        if not user or not bcrypt.verify(password, user["password_hash"]):
            return jsonify({"message": "Invalid credentials"}), 401

        token = generate_token(user["id"], user["email"], user["role"])
        return jsonify({"token": token}), 200

    except Exception as e:
        app.logger.error(f"Login error: {e}")
        return jsonify({"message": "An internal error occurred"}), 500


@app.route("/profile", methods=["GET"])
@token_required
def profile():
    try:
        return jsonify({
            "email": g.current_user.get("email"),
            "role": g.current_user.get("role")
        }), 200
    except Exception as e:
        app.logger.error(f"Profile error: {e}")
        return jsonify({"message": "An internal error occurred"}), 500


@app.route("/admin/users", methods=["GET"])
@token_required
@admin_required
def list_users():
    try:
        db = get_db()
        users = db.execute("SELECT id, email, role FROM users").fetchall()
        result = [{"id": u["id"], "email": u["email"], "role": u["role"]} for u in users]
        return jsonify(result), 200
    except Exception as e:
        app.logger.error(f"List users error: {e}")
        return jsonify({"message": "An internal error occurred"}), 500


@app.route("/admin/users/<int:user_id>", methods=["DELETE"])
@token_required
@admin_required
def delete_user(user_id):
    try:
        db = get_db()
        user = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            return jsonify({"message": "User not found"}), 404

        db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        db.commit()
        return jsonify({"message": "User deleted"}), 200

    except Exception as e:
        app.logger.error(f"Delete user error: {e}")
        return jsonify({"message": "An internal error occurred"}), 500


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)
else:
    init_db()