import os
import sqlite3
import datetime

from flask import Flask, request, jsonify, g
import jwt
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
APP_SECRET = os.environ.get("APP_SECRET", "default-secret-key")
DATABASE = "db.sqlite3"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user'
        )
    """)
    conn.commit()
    conn.close()


def get_current_user():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        payload = jwt.decode(token, APP_SECRET, algorithms=["HS256"])
        db = get_db()
        user = db.execute("SELECT * FROM users WHERE id = ?", (payload["user_id"],)).fetchone()
        return user
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, KeyError):
        return None


@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    if not data or "email" not in data or "password" not in data:
        return jsonify({"error": "email and password are required"}), 400

    email = data["email"]
    password = data["password"]

    if not email or not password:
        return jsonify({"error": "email and password are required"}), 400

    db = get_db()

    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        return jsonify({"error": "Email already in use"}), 400

    user_count = db.execute("SELECT COUNT(*) as cnt FROM users").fetchone()["cnt"]
    role = "admin" if user_count == 0 else "user"

    hashed = pbkdf2_sha256.hash(password)
    db.execute("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", (email, hashed, role))
    db.commit()

    return jsonify({"message": "Registration successful"}), 201


@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    if not data or "email" not in data or "password" not in data:
        return jsonify({"error": "Invalid credentials"}), 401

    email = data["email"]
    password = data["password"]

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if not user or not pbkdf2_sha256.verify(password, user["password"]):
        return jsonify({"error": "Invalid credentials"}), 401

    payload = {
        "user_id": user["id"],
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24),
    }
    token = jwt.encode(payload, APP_SECRET, algorithm="HS256")

    return jsonify({"token": token}), 200


@app.route("/profile", methods=["GET"])
def profile():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    return jsonify({"email": user["email"], "role": user["role"]}), 200


@app.route("/admin/users", methods=["GET"])
def admin_users():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    if user["role"] != "admin":
        return jsonify({"error": "Forbidden - admin access required"}), 403

    db = get_db()
    users = db.execute("SELECT id, email, role FROM users").fetchall()
    result = [{"id": u["id"], "email": u["email"], "role": u["role"]} for u in users]

    return jsonify(result), 200


@app.route("/admin/users/<int:user_id>", methods=["DELETE"])
def admin_delete_user(user_id):
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    if user["role"] != "admin":
        return jsonify({"error": "Forbidden - admin access required"}), 403

    db = get_db()
    target = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not target:
        return jsonify({"error": "User not found"}), 404

    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()

    return jsonify({"message": "User deleted"}), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)