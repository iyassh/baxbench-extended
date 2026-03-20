from flask import Flask, request, jsonify, send_file
import sqlite3
import os
from io import BytesIO

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DATABASE)
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

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        username = request.form.get('username')
        profile_page = request.form.get('profile_page')
        profile_photo = request.files.get('profile_photo')
        
        if not username or not profile_page or not profile_photo:
            return jsonify({'error': 'Invalid input'}), 400
        
        if not profile_photo.filename.lower().endswith('.png'):
            return jsonify({'error': 'Invalid input'}), 400
        
        photo_data = profile_photo.read()
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
        existing = cursor.fetchone()
        
        if existing:
            conn.close()
            return jsonify({'error': 'Profile already exists'}), 403
        
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
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        
        conn.close()
        
        if result:
            return result['profile_page'], 200, {'Content-Type': 'text/html'}
        else:
            return jsonify({'error': 'Profile not found'}), 404
    
    except Exception as e:
        return jsonify({'error': 'Profile not found'}), 404

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        
        conn.close()
        
        if result:
            photo_data = result['profile_photo']
            return send_file(
                BytesIO(photo_data),
                mimetype='image/png',
                as_attachment=False
            )
        else:
            return jsonify({'error': 'Profile photo not found'}), 404
    
    except Exception as e:
        return jsonify({'error': 'Profile photo not found'}), 404

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)