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
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
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


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({"error": "Unauthorized"}), 401
        token = auth_header[7:]
        try:
            payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            user_id = payload.get('user_id')
            if user_id is None:
                return jsonify({"error": "Unauthorized"}), 401
            db = get_db()
            user = db.execute('SELECT id, email FROM users WHERE id = ?', (user_id,)).fetchone()
            if user is None:
                return jsonify({"error": "Unauthorized"}), 401
            g.current_user_id = user['id']
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Unauthorized"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Unauthorized"}), 401
        except Exception:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Bad request"}), 400

        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({"error": "Email and password are required"}), 400

        if '@' not in email:
            return jsonify({"error": "Invalid email format"}), 400

        if len(password) < 6:
            return jsonify({"error": "Password must be at least 6 characters"}), 400

        password_hash = pbkdf2_sha256.hash(password)

        db = get_db()
        try:
            db.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', (email, password_hash))
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"error": "Email already in use"}), 400

        return jsonify({"message": "Registration successful"}), 201

    except Exception:
        return jsonify({"error": "Bad request"}), 400


@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Invalid credentials"}), 401

        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({"error": "Invalid credentials"}), 401

        db = get_db()
        user = db.execute('SELECT id, password_hash FROM users WHERE email = ?', (email,)).fetchone()

        if user is None:
            return jsonify({"error": "Invalid credentials"}), 401

        if not pbkdf2_sha256.verify(password, user['password_hash']):
            return jsonify({"error": "Invalid credentials"}), 401

        payload = {
            'user_id': user['id'],
            'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24),
            'iat': datetime.datetime.now(datetime.timezone.utc)
        }
        token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

        return jsonify({"token": token}), 200

    except Exception:
        return jsonify({"error": "Invalid credentials"}), 401


@app.route('/notes', methods=['POST'])
@token_required
def create_note():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Bad request"}), 400

        title = data.get('title', '')
        content = data.get('content', '')

        if not title:
            return jsonify({"error": "Title is required"}), 400

        db = get_db()
        cursor = db.execute(
            'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
            (g.current_user_id, title, content)
        )
        db.commit()

        return jsonify({"id": cursor.lastrowid, "message": "Note created"}), 201

    except Exception:
        return jsonify({"error": "Bad request"}), 400


@app.route('/notes', methods=['GET'])
@token_required
def list_notes():
    try:
        db = get_db()
        notes = db.execute(
            'SELECT id, title, content FROM notes WHERE user_id = ?',
            (g.current_user_id,)
        ).fetchall()

        result = [{"id": note['id'], "title": note['title'], "content": note['content']} for note in notes]
        return jsonify(result), 200

    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/notes/<int:note_id>', methods=['GET'])
@token_required
def get_note(note_id):
    try:
        db = get_db()
        note = db.execute('SELECT id, user_id, title, content FROM notes WHERE id = ?', (note_id,)).fetchone()

        if note is None:
            return jsonify({"error": "Note not found"}), 404

        if note['user_id'] != g.current_user_id:
            return jsonify({"error": "Forbidden"}), 403

        return jsonify({"id": note['id'], "title": note['title'], "content": note['content']}), 200

    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/notes/<int:note_id>', methods=['DELETE'])
@token_required
def delete_note(note_id):
    try:
        db = get_db()
        note = db.execute('SELECT id, user_id FROM notes WHERE id = ?', (note_id,)).fetchone()

        if note is None:
            return jsonify({"error": "Note not found"}), 404

        if note['user_id'] != g.current_user_id:
            return jsonify({"error": "Forbidden"}), 403

        db.execute('DELETE FROM notes WHERE id = ? AND user_id = ?', (note_id, g.current_user_id))
        db.commit()

        return jsonify({"message": "Note deleted"}), 200

    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)