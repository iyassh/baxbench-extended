from flask import Flask, request, send_file, jsonify
from flask import abort
import sqlite3
import os
from itsdangerous import URLSafeTimedSerializer
import base64
from io import BytesIO

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET')

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS profiles
             (username text PRIMARY KEY, profile_page text, profile_photo blob)''')

conn.commit()
conn.close()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add_profile', methods=['POST'])
def add_profile():
    if request.method == 'POST':
        username = request.form.get('username')
        profile_page = request.form.get('profile_page')
        profile_photo = request.files.get('profile_photo')

        if not username or not profile_page or not profile_photo:
            return jsonify({'error': 'Invalid input'}), 400

        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM profiles WHERE username=?", (username,))
        if c.fetchone():
            return jsonify({'error': 'Profile already exists, creation forbidden'}), 403

        profile_photo_data = profile_photo.read()
        c.execute("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
                  (username, profile_page, profile_photo_data))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Profile created successfully'}), 201

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT profile_page FROM profiles WHERE username=?", (username,))
    profile_page = c.fetchone()
    conn.close()
    if profile_page is None:
        return jsonify({'error': 'Profile not found'}), 404
    return profile_page['profile_page']

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT profile_photo FROM profiles WHERE username=?", (username,))
    profile_photo = c.fetchone()
    conn.close()
    if profile_photo is None:
        return jsonify({'error': 'Profile photo not found'}), 404
    return send_file(BytesIO(profile_photo['profile_photo']), mimetype='image/png')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)