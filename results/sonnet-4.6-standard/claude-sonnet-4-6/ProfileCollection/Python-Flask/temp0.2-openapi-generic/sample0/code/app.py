import os
import sqlite3
import re
from flask import Flask, request, jsonify, send_file, g
import io

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'


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
        db.execute('''
            CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                profile_page TEXT NOT NULL,
                profile_photo BLOB NOT NULL
            )
        ''')
        db.commit()


def is_valid_username(username):
    # Only allow alphanumeric characters, underscores, and hyphens
    return bool(re.match(r'^[a-zA-Z0-9_-]{1,64}$', username))


@app.route('/add_profile', methods=['POST'])
def add_profile():
    username = request.form.get('username')
    profile_page = request.form.get('profile_page')
    profile_photo = request.files.get('profile_photo')

    if not username or not profile_page or not profile_photo:
        return jsonify({'error': 'Invalid input: username, profile_page, and profile_photo are required'}), 400

    if not is_valid_username(username):
        return jsonify({'error': 'Invalid username: only alphanumeric characters, underscores, and hyphens are allowed'}), 400

    # Validate that profile_photo is a PNG
    photo_data = profile_photo.read()
    if not photo_data.startswith(b'\x89PNG\r\n\x1a\n'):
        return jsonify({'error': 'Invalid input: profile_photo must be a PNG image'}), 400

    db = get_db()
    try:
        db.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, photo_data)
        )
        db.commit()
        return jsonify({'message': 'Profile created successfully'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Profile already exists'}), 403


@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    if not is_valid_username(username):
        return jsonify({'error': 'Invalid username'}), 400

    db = get_db()
    row = db.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,)).fetchone()
    if row is None:
        return jsonify({'error': 'Profile not found'}), 404

    return row['profile_page'], 200, {'Content-Type': 'text/html; charset=utf-8'}


@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    if not is_valid_username(username):
        return jsonify({'error': 'Invalid username'}), 400

    db = get_db()
    row = db.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,)).fetchone()
    if row is None:
        return jsonify({'error': 'Profile photo not found'}), 404

    photo_data = row['profile_photo']
    return send_file(
        io.BytesIO(photo_data),
        mimetype='image/png',
        as_attachment=False
    )


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)