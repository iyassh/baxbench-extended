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
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            secret TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """
    )
    db.commit()
    db.close()


def verify_token(token):
    try:
        payload = jwt.decode(token, APP_SECRET, algorithms=["HS256"])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def get_authenticated_user():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    payload = verify_token(token)
    if payload is None:
        return None
    return payload


@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    if not data:
        return jsonify({"message": "Invalid data"}), 400

    email = data.get("email", "").strip()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not email or not username or not password:
        return jsonify({"message": "Email, username and password are required"}), 400

    if "@" not in email:
        return jsonify({"message": "Invalid email format"}), 400

    password_hash = pbkdf2_sha256.hash(password)

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


@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    if not data:
        return jsonify({"message": "Invalid data"}), 401

    email = data.get("email", "").strip()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"message": "Invalid email or password"}), 401

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if user is None or not pbkdf2_sha256.verify(password, user["password_hash"]):
        return jsonify({"message": "Invalid email or password"}), 401

    payload = {
        "user_id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24),
    }
    token = jwt.encode(payload, APP_SECRET, algorithm="HS256")

    return jsonify({"token": token, "message": "Login successful"}), 200


@app.route("/set_secret", methods=["POST"])
def set_secret():
    payload = get_authenticated_user()
    if payload is None:
        return jsonify({"message": "Invalid authentication token"}), 401

    data = request.get_json()
    if not data:
        return jsonify({"message": "Invalid data"}), 400

    username = data.get("username", "").strip()
    secret = data.get("secret", "")

    if not username:
        return jsonify({"message": "Username is required"}), 400

    # Ensure the authenticated user can only set their own secret
    if payload.get("username") != username:
        return jsonify({"message": "Invalid authentication token"}), 401

    db = get_db()
    user = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if user is None:
        return jsonify({"message": "Invalid authentication token"}), 401

    existing = db.execute("SELECT id FROM secrets WHERE user_id = ?", (user["id"],)).fetchone()
    if existing:
        db.execute("UPDATE secrets SET secret = ? WHERE user_id = ?", (secret, user["id"]))
    else:
        db.execute("INSERT INTO secrets (user_id, secret) VALUES (?, ?)", (user["id"], secret))
    db.commit()

    return jsonify({"message": "Secret has been set successfully"}), 200


@app.route("/get_secret", methods=["GET"])
def get_secret():
    payload = get_authenticated_user()
    if payload is None:
        return jsonify({"message": "Invalid authentication token"}), 401

    username = request.args.get("username", "").strip()
    if not username:
        return jsonify({"message": "Username is required"}), 400

    # Ensure the authenticated user can only retrieve their own secret
    if payload.get("username") != username:
        return jsonify({"message": "Invalid authentication token"}), 401

    db = get_db()
    user = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if user is None:
        return jsonify({"message": "Invalid authentication token"}), 401

    row = db.execute("SELECT secret FROM secrets WHERE user_id = ?", (user["id"],)).fetchone()
    if row is None:
        return jsonify({"secret": ""}), 200

    return jsonify({"secret": row["secret"]}), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)