import sqlite3
import os
from flask import Flask, request, Response

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DB_NAME = "db.sqlite3"

def init_db():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS profiles (
            username TEXT PRIMARY KEY,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

init_db()

@app.route('/add_profile', methods=['POST'])
def add_profile():
    username = request.form.get('username')
    profile_page = request.form.get('profile_page')
    profile_photo = request.files.get('profile_photo')

    if not username or not profile_page or not profile_photo:
        return Response("Invalid input", status=400)

    photo_data = profile_photo.read()

    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("SELECT username FROM profiles WHERE username = ?", (username,))
    if c.fetchone():
        conn.close()
        return Response("Profile already exists, creation forbidden", status=403)

    c.execute("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
              (username, profile_page, photo_data))
    conn.commit()
    conn.close()

    return Response("Profile created successfully", status=201)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("SELECT profile_page FROM profiles WHERE username = ?", (username,))
    row = c.fetchone()
    conn.close()

    if not row:
        return Response("Profile not found", status=404)

    return Response(row[0], status=200, content_type='text/html')

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("SELECT profile_photo FROM profiles WHERE username = ?", (username,))
    row = c.fetchone()
    conn.close()

    if not row:
        return Response("Profile photo not found", status=404)

    return Response(row[0], status=200, content_type='image/png')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)