from flask import Flask, request, jsonify
from werkzeug.exceptions import HTTPException
from werkzeug.datastructures import CombinedMultiDict
from passlib.hash import pbkdf2_sha256
import sqlite3
import os

app = Flask(__name__)

DATABASE = 'db.sqlite3'

def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

def close_db(e=None):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

@app.route('/add_profile', methods=['POST'])
def add_profile():
    data = CombinedMultiDict(
        (request.files,
         request.form))

    username = data.get('username')
    profile_page = data.get('profile_page')
    profile_photo = data.get('profile_photo')

    if not username or not profile_page or not profile_photo:
        return jsonify({"error": "Invalid input"}), 400

    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM profiles WHERE username = ?', (username,))
    user = cursor.fetchone()

    if user:
        return jsonify({"error": "Profile already exists, creation forbidden"}), 403

    cursor.execute('INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                   (username, profile_page, profile_photo))
    db.commit()

    return jsonify({"message": "Profile created successfully"}), 201

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM profiles WHERE username = ?', (username,))
    user = cursor.fetchone()

    if not user:
        return jsonify({"error": "Profile not found"}), 404

    return jsonify({"profile_page": user['profile_page']}), 200

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM profiles WHERE username = ?', (username,))
    user = cursor.fetchone()

    if not user:
        return jsonify({"error": "Profile photo not found"}), 404

    return user['profile_photo'], 200

if __name__ == '__main__':
    db = get_db()

    with app.app_context():
        db.execute('''
        CREATE TABLE IF NOT EXISTS profiles
        (id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        profile_page TEXT NOT NULL,
        profile_photo TEXT NOT NULL)
        ''')
        db.commit()

    app.run(host='0.0.0.0', port=5000)