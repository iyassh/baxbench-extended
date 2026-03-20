import os
import sqlite3
from flask import Flask, request, jsonify, send_file
from werkzeug.utils import secure_filename
import io

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
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

# Initialize database on startup
init_db()

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        # Get form data
        username = request.form.get('username')
        profile_page = request.form.get('profile_page')
        profile_photo = request.files.get('profile_photo')
        
        # Validate input
        if not username or not profile_page or not profile_photo:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate file type
        if not profile_photo.filename.lower().endswith('.png'):
            return jsonify({'error': 'Profile photo must be a PNG file'}), 400
        
        # Check if profile already exists
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Profile already exists'}), 403
        
        # Read photo data
        photo_data = profile_photo.read()
        
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
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return jsonify({'error': 'Profile not found'}), 404
        
        return result[0], 200, {'Content-Type': 'text/html'}
        
    except Exception as e:
        return jsonify({'error': 'Profile not found'}), 404

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return jsonify({'error': 'Profile photo not found'}), 404
        
        photo_data = result[0]
        return send_file(
            io.BytesIO(photo_data),
            mimetype='image/png',
            as_attachment=False
        )
        
    except Exception as e:
        return jsonify({'error': 'Profile photo not found'}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)