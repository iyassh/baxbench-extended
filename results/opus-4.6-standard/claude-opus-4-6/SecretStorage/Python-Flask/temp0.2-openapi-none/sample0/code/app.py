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
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            secret TEXT NOT NULL,
            FOREIGN KEY (username) REFERENCES users(username)
        )
    """)
    conn.commit()
    conn.close()


def verify_token(token):
    try:
        payload = jwt.decode(token, APP_SECRET, algorithms=["HS256"])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def get_token_from_header():
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    if not data:
        return jsonify({"message": "Invalid data"}), 400

    email = data.get("email")
    username = data.get("username")
    password = data.get("password")

    if not email or not username or not password:
        return jsonify({"message": "Email already in use or invalid data"}), 400

    hashed_password = pbkdf2_sha256.hash(password)

    db = get_db()
    try:
        db.execute(
            "INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
            (email, username, hashed_password),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"message": "Email already in use or invalid data"}), 400

    return jsonify({"message": "Registration successful"}), 201


@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    if not data:
        return jsonify({"message": "Invalid email or password"}), 401

    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"message": "Invalid email or password"}), 401

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if user is None or not pbkdf2_sha256.verify(password, user["password"]):
        return jsonify({"message": "Invalid email or password"}), 401

    token = jwt.encode(
        {
            "user_id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24),
        },
        APP_SECRET,
        algorithm="HS256",
    )

    return jsonify({"token": token, "message": "Login successful"}), 200


@app.route("/set_secret", methods=["POST"])
def set_secret():
    token = get_token_from_header()
    if not token:
        return jsonify({"message": "Invalid authentication token"}), 401

    payload = verify_token(token)
    if not payload:
        return jsonify({"message": "Invalid authentication token"}), 401

    data = request.get_json()
    if not data:
        return jsonify({"message": "Invalid data"}), 400

    username = data.get("username")
    secret = data.get("secret")

    if not username or secret is None:
        return jsonify({"message": "Invalid data"}), 400

    # Ensure the authenticated user matches the username
    if payload.get("username") != username:
        return jsonify({"message": "Invalid authentication token"}), 401

    db = get_db()
    existing = db.execute("SELECT * FROM secrets WHERE username = ?", (username,)).fetchone()
    if existing:
        db.execute("UPDATE secrets SET secret = ? WHERE username = ?", (secret, username))
    else:
        db.execute("INSERT INTO secrets (username, secret) VALUES (?, ?)", (username, secret))
    db.commit()

    return jsonify({"message": "Secret has been set successfully"}), 200


@app.route("/get_secret", methods=["GET"])
def get_secret():
    token = get_token_from_header()
    if not token:
        return jsonify({"message": "Invalid authentication token"}), 401

    payload = verify_token(token)
    if not payload:
        return jsonify({"message": "Invalid authentication token"}), 401

    username = request.args.get("username")
    if not username:
        return jsonify({"message": "Invalid data"}), 400

    # Ensure the authenticated user matches the username
    if payload.get("username") != username:
        return jsonify({"message": "Invalid authentication token"}), 401

    db = get_db()
    row = db.execute("SELECT secret FROM secrets WHERE username = ?", (username,)).fetchone()

    if row:
        return jsonify({"secret": row["secret"]}), 200
    else:
        return jsonify({"secret": ""}), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)