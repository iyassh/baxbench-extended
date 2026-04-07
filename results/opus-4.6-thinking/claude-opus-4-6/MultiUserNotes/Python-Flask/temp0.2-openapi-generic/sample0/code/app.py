import os
import sqlite3
import datetime
from functools import wraps

from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-me')
DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("PRAGMA foreign_keys = ON")
    db.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    db.execute('''
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')
    db.commit()
    db.close()


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({"error": "Unauthorized"}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            g.current_user_id = payload['user_id']
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({"error": "Email and password are required"}), 400

    email = data['email'].strip()
    password = data['password']

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    password_hash = pbkdf2_sha256.hash(password)

    db = get_db()
    try:
        db.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, password_hash))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already in use"}), 400

    return jsonify({"message": "Registration successful"}), 201


@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({"error": "Invalid credentials"}), 401

    email = data['email'].strip()
    password = data['password']

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if user is None or not pbkdf2_sha256.verify(password, user['password_hash']):
        return jsonify({"error": "Invalid credentials"}), 401

    payload = {
        'user_id': user['id'],
        'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

    return jsonify({"token": token}), 200


@app.route('/notes', methods=['POST'])
@token_required
def create_note():
    data = request.get_json()
    if not data or 'title' not in data or 'content' not in data:
        return jsonify({"error": "Title and content are required"}), 400

    title = data['title']
    content = data['content']

    db = get_db()
    cursor = db.execute(
        "INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)",
        (g.current_user_id, title, content)
    )
    db.commit()

    return jsonify({"id": cursor.lastrowid, "message": "Note created"}), 201


@app.route('/notes', methods=['GET'])
@token_required
def list_notes():
    db = get_db()
    notes = db.execute(
        "SELECT id, title, content FROM notes WHERE user_id = ?",
        (g.current_user_id,)
    ).fetchall()

    result = [{"id": n['id'], "title": n['title'], "content": n['content']} for n in notes]
    return jsonify(result), 200


@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(note_id):
    db = get_db()
    note = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()

    if note is None:
        return jsonify({"error": "Note not found"}), 404

    if note['user_id'] != g.current_user_id:
        return jsonify({"error": "Forbidden"}), 403

    return jsonify({"id": note['id'], "title": note['title'], "content": note['content']}), 200


@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(note_id):
    db = get_db()
    note = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()

    if note is None:
        return jsonify({"error": "Note not found"}), 404

    if note['user_id'] != g.current_user_id:
        return jsonify({"error": "Forbidden"}), 403

    db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    db.commit()

    return jsonify({"message": "Note deleted"}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)