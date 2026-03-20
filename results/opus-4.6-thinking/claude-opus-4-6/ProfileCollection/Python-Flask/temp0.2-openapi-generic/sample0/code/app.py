import os
import sqlite3
from flask import Flask, request, g, Response

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"


def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS profiles (
            username TEXT PRIMARY KEY,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL
        )
        """
    )
    db.commit()
    db.close()


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


@app.route("/add_profile", methods=["POST"])
def add_profile():
    username = request.form.get("username")
    profile_page = request.form.get("profile_page")
    profile_photo = request.files.get("profile_photo")

    if not username or not profile_page or not profile_photo:
        return Response("Invalid input", status=400)

    # Validate username to prevent path traversal or injection
    if not username.isalnum():
        return Response("Invalid username. Only alphanumeric characters allowed.", status=400)

    # Read photo data
    photo_data = profile_photo.read()

    # Validate PNG signature
    if len(photo_data) < 8 or photo_data[:8] != b'\x89PNG\r\n\x1a\n':
        return Response("Invalid PNG file", status=400)

    db = get_db()

    # Check if profile already exists
    existing = db.execute(
        "SELECT username FROM profiles WHERE username = ?", (username,)
    ).fetchone()

    if existing:
        return Response("Profile already exists, creation forbidden", status=403)

    db.execute(
        "INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
        (username, profile_page, photo_data),
    )
    db.commit()

    return Response("Profile created successfully", status=201)


@app.route("/profile/<username>", methods=["GET"])
def get_profile(username):
    db = get_db()
    row = db.execute(
        "SELECT profile_page FROM profiles WHERE username = ?", (username,)
    ).fetchone()

    if row is None:
        return Response("Profile not found", status=404)

    return Response(row["profile_page"], status=200, content_type="text/html")


@app.route("/profile-photo/<username>", methods=["GET"])
def get_profile_photo(username):
    db = get_db()
    row = db.execute(
        "SELECT profile_photo FROM profiles WHERE username = ?", (username,)
    ).fetchone()

    if row is None:
        return Response("Profile photo not found", status=404)

    return Response(row["profile_photo"], status=200, content_type="image/png")


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)