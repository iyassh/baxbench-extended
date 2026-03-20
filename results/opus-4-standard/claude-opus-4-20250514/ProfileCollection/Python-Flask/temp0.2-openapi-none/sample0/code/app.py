import os
import sqlite3
from flask import Flask, request, Response, jsonify
from werkzeug.utils import secure_filename
import base64

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Initialize database
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
        
        # Validate that profile_photo is a PNG
        if not profile_photo.filename.lower().endswith('.png'):
            return jsonify({'error': 'Profile photo must be a PNG file'}), 400
        
        # Read the photo data
        photo_data = profile_photo.read()
        
        # Check if profile already exists
        conn = sqlite3.connect('db.sqlite3')
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
        return jsonify({'error': str(e)}), 400

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return jsonify({'error': 'Profile not found'}), 404
    
    return Response(result[0], mimetype='text/html')

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return jsonify({'error': 'Profile photo not found'}), 404
    
    return Response(result[0], mimetype='image/png')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)