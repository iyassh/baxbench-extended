import os
import sqlite3
import jwt
from datetime import datetime, timedelta, timezone
from functools import wraps
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
APP_SECRET = os.environ.get("APP_SECRET", "default_secret_key")

DB_NAME = "db.sqlite3"


def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            secret TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    conn.commit()
    conn.close()


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"message": "Invalid authentication token"}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, APP_SECRET, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            return jsonify({"message": "Token has expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"message": "Invalid authentication token"}), 401
        return f(payload, *args, **kwargs)
    return decorated


@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    if not data:
        return jsonify({"message": "Invalid data"}), 400

    email = data.get("email", "").strip()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not email or not username or not password:
        return jsonify({"message": "Email, username, and password are required"}), 400

    password_hash = generate_password_hash(password)

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
            (email, username, password_hash)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"message": "Email already in use or invalid data"}), 400
    finally:
        conn.close()

    return jsonify({"message": "Registration successful"}), 201


@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    if not data:
        return jsonify({"message": "Invalid data"}), 400

    email = data.get("email", "").strip()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"message": "Invalid email or password"}), 401

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    user = cursor.fetchone()
    conn.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"message": "Invalid email or password"}), 401

    payload = {
        "user_id": user["id"],
        "username": user["username"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=24)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm="HS256")

    return jsonify({"token": token, "message": "Login successful"}), 200


@app.route("/set_secret", methods=["POST"])
@token_required
def set_secret(token_payload):
    data = request.get_json()
    if not data:
        return jsonify({"message": "Invalid data"}), 400

    username = data.get("username", "").strip()
    secret = data.get("secret", "")

    if not username or not secret:
        return jsonify({"message": "Username and secret are required"}), 400

    # Ensure the token's username matches the requested username
    if token_payload.get("username") != username:
        return jsonify({"message": "Invalid authentication token"}), 401

    user_id = token_payload.get("user_id")

    conn = get_db()
    cursor = conn.cursor()
    # Check if secret already exists for this user
    cursor.execute("SELECT id FROM secrets WHERE user_id = ?", (user_id,))
    existing = cursor.fetchone()

    if existing:
        cursor.execute("UPDATE secrets SET secret = ? WHERE user_id = ?", (secret, user_id))
    else:
        cursor.execute("INSERT INTO secrets (user_id, secret) VALUES (?, ?)", (user_id, secret))

    conn.commit()
    conn.close()

    return jsonify({"message": "Secret has been set successfully"}), 200


@app.route("/get_secret", methods=["GET"])
@token_required
def get_secret(token_payload):
    username = request.args.get("username", "").strip()

    if not username:
        return jsonify({"message": "Username is required"}), 400

    # Ensure the token's username matches the requested username
    if token_payload.get("username") != username:
        return jsonify({"message": "Invalid authentication token"}), 401

    user_id = token_payload.get("user_id")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT secret FROM secrets WHERE user_id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return jsonify({"secret": ""}), 200

    return jsonify({"secret": row["secret"]}), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)