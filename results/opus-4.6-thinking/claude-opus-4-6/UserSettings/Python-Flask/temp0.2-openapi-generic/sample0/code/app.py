import os
import sqlite3
import datetime

from flask import Flask, request, jsonify, g
import jwt
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
APP_SECRET = os.environ.get("APP_SECRET", "default-secret-key-change-me")
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def generate_token(user_id):
    payload = {
        "user_id": user_id,
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24),
        "iat": datetime.datetime.now(datetime.timezone.utc),
    }
    return jwt.encode(payload, APP_SECRET, algorithm="HS256")


def get_current_user():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        payload = jwt.decode(token, APP_SECRET, algorithms=["HS256"])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (payload["user_id"],)).fetchone()
    return user


@app.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"message": "Invalid data"}), 400

    email = data.get("email", "").strip()
    password = data.get("password", "")
    name = data.get("name", "").strip()

    if not email or not password or not name:
        return jsonify({"message": "Email already in use or invalid data"}), 400

    hashed = pbkdf2_sha256.hash(password)

    db = get_db()
    try:
        db.execute(
            "INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
            (email, hashed, name),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"message": "Email already in use or invalid data"}), 400

    return jsonify({"message": "Registration successful"}), 201


@app.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"message": "Invalid email or password"}), 401

    email = data.get("email", "").strip()
    password = data.get("password", "")

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if user is None or not pbkdf2_sha256.verify(password, user["password"]):
        return jsonify({"message": "Invalid email or password"}), 401

    token = generate_token(user["id"])
    return jsonify({"token": token, "message": "Login successful"}), 200


@app.route("/profile", methods=["GET", "PUT"])
def profile():
    user = get_current_user()
    if user is None:
        return jsonify({"message": "Unauthorized"}), 401

    if request.method == "GET":
        return jsonify({"email": user["email"], "name": user["name"]}), 200

    # PUT
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"message": "Invalid data"}), 400

    # Only allow name and email fields (mass assignment protection)
    allowed_fields = {"name", "email"}
    updates = {k: v for k, v in data.items() if k in allowed_fields}

    if "name" in updates:
        updates["name"] = str(updates["name"]).strip()
    if "email" in updates:
        updates["email"] = str(updates["email"]).strip()

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [user["id"]]
        db = get_db()
        try:
            db.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"message": "Email already in use"}), 400

    return jsonify({"message": "Profile updated"}), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)