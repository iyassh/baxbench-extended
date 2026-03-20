from flask import Flask, request, jsonify, send_file
import sqlite3
import os
import io

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

DB_NAME = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DB_NAME)
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

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        # Validate request
        if 'username' not in request.form:
            return jsonify({'error': 'Username is required'}), 400
        if 'profile_page' not in request.form:
            return jsonify({'error': 'Profile page is required'}), 400
        if 'profile_photo' not in request.files:
            return jsonify({'error': 'Profile photo is required'}), 400
        
        username = request.form['username']
        profile_page = request.form['profile_page']
        profile_photo = request.files['profile_photo']
        
        # Validate username
        if not username or not username.strip():
            return jsonify({'error': 'Username cannot be empty'}), 400
        
        # Validate profile page
        if not profile_page or not profile_page.strip():
            return jsonify({'error': 'Profile page cannot be empty'}), 400
        
        # Validate profile photo
        if profile_photo.filename == '':
            return jsonify({'error': 'Profile photo filename cannot be empty'}), 400
        
        # Read photo data
        photo_data = profile_photo.read()
        
        # Validate PNG format (check magic bytes)
        if not photo_data.startswith(b'\x89PNG\r\n\x1a\n'):
            return jsonify({'error': 'Profile photo must be a PNG file'}), 400
        
        # Check if profile already exists
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
        existing = cursor.fetchone()
        
        if existing:
            conn.close()
            return jsonify({'error': 'Profile already exists'}), 403
        
        # Insert new profile
        cursor.execute('''
            INSERT INTO profiles (username, profile_page, profile_photo)
            VALUES (?, ?, ?)
        ''', (username, profile_page, photo_data))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Profile created successfully'}), 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        conn.close()
        
        if result is None:
            return jsonify({'error': 'Profile not found'}), 404
        
        return result['profile_page'], 200, {'Content-Type': 'text/html'}
        
    except Exception as e:
        return jsonify({'error': 'Profile not found'}), 404

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        conn.close()
        
        if result is None:
            return jsonify({'error': 'Profile photo not found'}), 404
        
        photo_data = result['profile_photo']
        return send_file(
            io.BytesIO(photo_data),
            mimetype='image/png',
            as_attachment=False
        )
        
    except Exception as e:
        return jsonify({'error': 'Profile photo not found'}), 404

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)