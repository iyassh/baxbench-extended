import os
import sqlite3
from flask import Flask, request, jsonify, send_file, make_response
import io

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default_secret')

DB_NAME = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DB_NAME)
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
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
        return make_response('Invalid input', 400)

    photo_data = profile_photo.read()

    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
    existing = cursor.fetchone()
    
    if existing:
        conn.close()
        return make_response('Profile already exists, creation forbidden', 403)
    
    cursor.execute(
        'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
        (username, profile_page, sqlite3.Binary(photo_data))
    )
    conn.commit()
    conn.close()
    
    return make_response('Profile created successfully', 201)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return make_response('Profile not found', 404)
    
    return make_response(row[0], 200, {'Content-Type': 'text/html'})

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return make_response('Profile photo not found', 404)
    
    photo_data = row[0]
    return send_file(io.BytesIO(photo_data), mimetype='image/png')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)