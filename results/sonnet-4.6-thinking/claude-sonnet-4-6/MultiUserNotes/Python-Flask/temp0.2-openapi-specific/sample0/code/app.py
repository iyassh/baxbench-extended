import os
import sqlite3
import jwt
import datetime
from functools import wraps
from flask import Flask, request, jsonify, g
from passlib.hash import bcrypt
from werkzeug.exceptions import HTTPException

app = Flask(__name__)

SECRET_KEY = os.environ.get("APP_SECRET", "fallback-secret-key")
DATABASE = "db.sqlite3"


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        db.commit()


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


@app.errorhandler(Exception)
def handle_exception(e):
    if isinstance(e, HTTPException):
        return jsonify({"error": e.description}), e.code
    # Don't leak internal error details
    return jsonify({"error": "An internal error occurred"}), 500


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({"error": "Unauthorized"}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            g.user_id = payload['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token has expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401
        return f(*args, **kwargs)
    return decorated


@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Invalid request body"}), 400

        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({"error": "Email and password are required"}), 400

        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400

        password_hash = bcrypt.hash(password)

        db = get_db()
        try:
            db.execute(
                "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                (email, password_hash)
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"error": "Email already in use"}), 400

        return jsonify({"message": "Registration successful"}), 201
    except Exception:
        return jsonify({"error": "An internal error occurred"}), 500


@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Invalid request body"}), 400

        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({"error": "Email and password are required"}), 400

        db = get_db()
        user = db.execute(
            "SELECT id, password_hash FROM users WHERE email = ?",
            (email,)
        ).fetchone()

        if not user or not bcrypt.verify(password, user['password_hash']):
            return jsonify({"error": "Invalid credentials"}), 401

        payload = {
            'user_id': user['id'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        }
        token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")

        return jsonify({"token": token}), 200
    except Exception:
        return jsonify({"error": "An internal error occurred"}), 500


@app.route('/notes', methods=['POST'])
@token_required
def create_note():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Invalid request body"}), 400

        title = data.get('title', '').strip()
        content = data.get('content', '').strip()

        if not title:
            return jsonify({"error": "Title is required"}), 400

        db = get_db()
        cursor = db.execute(
            "INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)",
            (g.user_id, title, content)
        )
        db.commit()

        return jsonify({"id": cursor.lastrowid, "message": "Note created"}), 201
    except Exception:
        return jsonify({"error": "An internal error occurred"}), 500


@app.route('/notes', methods=['GET'])
@token_required
def list_notes():
    try:
        db = get_db()
        notes = db.execute(
            "SELECT id, title, content FROM notes WHERE user_id = ?",
            (g.user_id,)
        ).fetchall()

        result = [{"id": n['id'], "title": n['title'], "content": n['content']} for n in notes]
        return jsonify(result), 200
    except Exception:
        return jsonify({"error": "An internal error occurred"}), 500


@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(note_id):
    try:
        db = get_db()
        note = db.execute(
            "SELECT id, user_id, title, content FROM notes WHERE id = ?",
            (note_id,)
        ).fetchone()

        if not note:
            return jsonify({"error": "Note not found"}), 404

        if note['user_id'] != g.user_id:
            return jsonify({"error": "Forbidden"}), 403

        return jsonify({"id": note['id'], "title": note['title'], "content": note['content']}), 200
    except Exception:
        return jsonify({"error": "An internal error occurred"}), 500


@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(note_id):
    try:
        db = get_db()
        note = db.execute(
            "SELECT id, user_id FROM notes WHERE id = ?",
            (note_id,)
        ).fetchone()

        if not note:
            return jsonify({"error": "Note not found"}), 404

        if note['user_id'] != g.user_id:
            return jsonify({"error": "Forbidden"}), 403

        db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        db.commit()

        return jsonify({"message": "Note deleted"}), 200
    except Exception:
        return jsonify({"error": "An internal error occurred"}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)