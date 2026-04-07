from flask import Flask, request, jsonify, g
import sqlite3
import jwt
import bcrypt
import os

app = Flask(__name__)
SECRET = os.environ.get("APP_SECRET", "default-secret")
DATABASE = "notes.db"

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, content TEXT)")
    db.commit()
    db.close()

def get_user_from_token():
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        return None
    token = auth.split(" ")[1]
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
        return payload["user_id"]
    except:
        return None

@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    email = data.get("email")
    password = data.get("password")
    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400
    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
    db = get_db()
    try:
        db.execute("INSERT INTO users (email, password) VALUES (?, ?)", (email, hashed.decode('utf-8')))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already exists"}), 409
    return jsonify({"message": "User registered"}), 201

@app.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    email = data.get("email")
    password = data.get("password")
    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not bcrypt.checkpw(password.encode('utf-8'), user["password"].encode('utf-8')):
        return jsonify({"error": "Invalid credentials"}), 401
    token = jwt.encode({"user_id": user["id"]}, SECRET, algorithm="HS256")
    return jsonify({"token": token}), 200

@app.route("/notes", methods=["POST"])
def create_note():
    user_id = get_user_from_token()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json()
    title = data.get("title")
    content = data.get("content")
    if not title:
        return jsonify({"error": "Title required"}), 400
    db = get_db()
    cursor = db.execute("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", (user_id, title, content))
    db.commit()
    return jsonify({"id": cursor.lastrowid}), 201

@app.route("/notes", methods=["GET"])
def get_notes():
    user_id = get_user_from_token()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    db = get_db()
    notes = db.execute("SELECT * FROM notes WHERE user_id = ?", (user_id,)).fetchall()
    return jsonify([dict(n) for n in notes]), 200

@app.route("/notes/<int:note_id>", methods=["GET"])
def get_note(note_id):
    user_id = get_user_from_token()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    db = get_db()
    note = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not note:
        return jsonify({"error": "Not found"}), 404
    if note["user_id"] != user_id:
        return jsonify({"error": "Forbidden"}), 403
    return jsonify(dict(note)), 200

@app.route("/notes/<int:note_id>", methods=["DELETE"])
def delete_note(note_id):
    user_id = get_user_from_token()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
    db = get_db()
    note = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not note:
        return jsonify({"error": "Not found"}), 404
    if note["user_id"] != user_id:
        return jsonify({"error": "Forbidden"}), 403
    db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    db.commit()
    return jsonify({"message": "Deleted"}), 200

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)
