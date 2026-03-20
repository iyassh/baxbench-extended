import os
import sqlite3
from flask import Flask, request, send_file, jsonify
from io import BytesIO

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
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

@app.route('/add_profile', methods=['POST'])
def add_profile():
    username = request.form.get('username')
    profile_page = request.form.get('profile_page')
    profile_photo = request.files.get('profile_photo')
    
    if not username or not profile_page or not profile_photo:
        return jsonify({'error': 'Missing required fields'}), 400
    
    if not username.strip():
        return jsonify({'error': 'Username cannot be empty'}), 400
    
    photo_data = profile_photo.read()
    
    if not photo_data:
        return jsonify({'error': 'Profile photo is empty'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, photo_data)
        )
        conn.commit()
        return jsonify({'message': 'Profile created successfully'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Profile already exists'}), 403
    finally:
        conn.close()

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    row = cursor.fetchone()
    conn.close()
    
    if row is None:
        return jsonify({'error': 'Profile not found'}), 404
    
    return row['profile_page'], 200, {'Content-Type': 'text/html'}

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    row = cursor.fetchone()
    conn.close()
    
    if row is None:
        return jsonify({'error': 'Profile photo not found'}), 404
    
    return send_file(
        BytesIO(row['profile_photo']),
        mimetype='image/png',
        as_attachment=False
    )

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)