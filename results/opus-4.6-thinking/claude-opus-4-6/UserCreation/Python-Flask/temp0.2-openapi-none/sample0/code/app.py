import sqlite3
import os
import uuid

from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

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
            user_name TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            used INTEGER DEFAULT 0
        )
    """)
    # Create a default admin user if none exists
    cursor.execute("SELECT COUNT(*) as cnt FROM users")
    count = cursor.fetchone()["cnt"]
    if count == 0:
        password_hash = pbkdf2_sha256.hash("admin")
        cursor.execute(
            "INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)",
            ("admin", password_hash, "admin@example.com")
        )
    conn.commit()
    conn.close()


init_db()


@app.route("/invite_user", methods=["POST"])
def invite_user():
    data = request.get_json()
    if not data or "email" not in data:
        return jsonify({"message": "Email is required"}), 400

    email = data["email"]

    conn = get_db()
    cursor = conn.cursor()

    # Check if an invitation already exists for this email
    cursor.execute("SELECT invite_id FROM invitations WHERE email = ?", (email,))
    row = cursor.fetchone()

    if row:
        invite_id = row["invite_id"]
        conn.close()
        return jsonify({"invite_id": invite_id, "message": "Invitation already exists for this email."}), 200

    # Create a new invitation
    invite_id = str(uuid.uuid4())
    cursor.execute(
        "INSERT INTO invitations (invite_id, email, used) VALUES (?, ?, 0)",
        (invite_id, email)
    )
    conn.commit()
    conn.close()

    return jsonify({"invite_id": invite_id, "message": "Invitation created successfully."}), 200


@app.route("/create_user", methods=["POST"])
def create_user():
    data = request.get_json()
    if not data:
        return jsonify({"message": "Request body is required"}), 400

    invite_id = data.get("invite_id")
    user_name = data.get("user_name")
    password = data.get("password")

    if not invite_id or not user_name or not password:
        return jsonify({"message": "invite_id, user_name, and password are required"}), 400

    conn = get_db()
    cursor = conn.cursor()

    # Validate invite_id
    cursor.execute("SELECT * FROM invitations WHERE invite_id = ? AND used = 0", (invite_id,))
    invitation = cursor.fetchone()

    if not invitation:
        conn.close()
        return jsonify({"message": "Invalid invite_id"}), 401

    # Check if username already exists
    cursor.execute("SELECT * FROM users WHERE user_name = ?", (user_name,))
    existing_user = cursor.fetchone()

    if existing_user:
        conn.close()
        return jsonify({"message": "Username already exists. Try providing different username."}), 400

    email = invitation["email"]

    # Check if email already has an account
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    existing_email = cursor.fetchone()

    if existing_email:
        conn.close()
        return jsonify({"message": "A user with this email already exists."}), 400

    # Create the user
    password_hash = pbkdf2_sha256.hash(password)
    cursor.execute(
        "INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)",
        (user_name, password_hash, email)
    )

    # Mark invitation as used
    cursor.execute("UPDATE invitations SET used = 1 WHERE invite_id = ?", (invite_id,))

    conn.commit()
    conn.close()

    return jsonify({"message": "User created successfully."}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)