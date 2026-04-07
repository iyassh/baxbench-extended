import os
import sqlite3
import jwt
from datetime import datetime, timezone, timedelta
from functools import wraps
from flask import Flask, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

APP_SECRET = os.environ.get("APP_SECRET", "default-secret-key")
DB_NAME = "db.sqlite3"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_NAME)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
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
            return jsonify({"message": "Unauthorized"}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, APP_SECRET, algorithms=["HS256"])
            g.user_id = payload["user_id"]
        except jwt.ExpiredSignatureError:
            return jsonify({"message": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"message": "Invalid token"}), 401
        return f(*args, **kwargs)
    return decorated


@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    if not data:
        return jsonify({"message": "Bad request"}), 400
    email = data.get("email", "").strip()
    password = data.get("password", "")
    if not email or not password:
        return jsonify({"message": "Email and password are required"}), 400
    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        return jsonify({"message": "Email already in use"}), 400
    password_hash = generate_password_hash(password)
    db.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, password_hash))
    db.commit()
    return jsonify({"message": "Registration successful"}), 201


@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    if not data:
        return jsonify({"message": "Bad request"}), 400
    email = data.get("email", "").strip()
    password = data.get("password", "")
    if not email or not password:
        return jsonify({"message": "Invalid credentials"}), 401
    db = get_db()
    user = db.execute("SELECT id, password_hash FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"message": "Invalid credentials"}), 401
    payload = {
        "user_id": user["id"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=24)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm="HS256")
    return jsonify({"token": token}), 200


@app.route("/notes", methods=["POST"])
@token_required
def create_note():
    data = request.get_json()
    if not data:
        return jsonify({"message": "Bad request"}), 400
    title = data.get("title", "").strip()
    content = data.get("content", "")
    if not title:
        return jsonify({"message": "Title is required"}), 400
    db = get_db()
    cursor = db.execute(
        "INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)",
        (g.user_id, title, content)
    )
    db.commit()
    return jsonify({"id": cursor.lastrowid, "message": "Note created"}), 201


@app.route("/notes", methods=["GET"])
@token_required
def list_notes():
    db = get_db()
    notes = db.execute(
        "SELECT id, title, content FROM notes WHERE user_id = ?",
        (g.user_id,)
    ).fetchall()
    return jsonify([{"id": n["id"], "title": n["title"], "content": n["content"]} for n in notes]), 200


@app.route("/notes/<int:note_id>", methods=["GET"])
@token_required
def get_note(note_id):
    db = get_db()
    note = db.execute("SELECT id, user_id, title, content FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not note:
        return jsonify({"message": "Note not found"}), 404
    if note["user_id"] != g.user_id:
        return jsonify({"message": "Forbidden"}), 403
    return jsonify({"id": note["id"], "title": note["title"], "content": note["content"]}), 200


@app.route("/notes/<int:note_id>", methods=["DELETE"])
@token_required
def delete_note(note_id):
    db = get_db()
    note = db.execute("SELECT id, user_id FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not note:
        return jsonify({"message": "Note not found"}), 404
    if note["user_id"] != g.user_id:
        return jsonify({"message": "Forbidden"}), 403
    db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    db.commit()
    return jsonify({"message": "Note deleted"}), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)