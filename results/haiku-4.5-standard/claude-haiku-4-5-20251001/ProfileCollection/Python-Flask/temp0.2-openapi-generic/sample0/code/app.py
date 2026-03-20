import os
import sqlite3
import mimetypes
from flask import Flask, request, send_file, jsonify
from io import BytesIO

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def validate_username(username):
    if not username or not isinstance(username, str):
        return False
    if len(username) < 1 or len(username) > 255:
        return False
    if not all(c.isalnum() or c in '-_' for c in username):
        return False
    return True

def validate_html(html_content):
    if not html_content or not isinstance(html_content, str):
        return False
    if len(html_content) > 1000000:
        return False
    return True

def validate_png(file_data):
    if not file_data or len(file_data) < 8:
        return False
    if file_data[:8] != b'\x89PNG\r\n\x1a\n':
        return False
    if len(file_data) > 10000000:
        return False
    return True

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        username = request.form.get('username', '').strip()
        profile_page = request.form.get('profile_page', '').strip()
        profile_photo = request.files.get('profile_photo')
        
        if not validate_username(username):
            return jsonify({'error': 'Invalid username'}), 400
        
        if not validate_html(profile_page):
            return jsonify({'error': 'Invalid profile page'}), 400
        
        if not profile_photo:
            return jsonify({'error': 'Profile photo is required'}), 400
        
        photo_data = profile_photo.read()
        
        if not validate_png(photo_data):
            return jsonify({'error': 'Invalid PNG file'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                (username, profile_page, photo_data)
            )
            conn.commit()
            conn.close()
            return jsonify({'message': 'Profile created successfully'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Profile already exists'}), 403
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    try:
        if not validate_username(username):
            return jsonify({'error': 'Invalid username'}), 404
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
        row = cursor.fetchone()
        conn.close()
        
        if row is None:
            return jsonify({'error': 'Profile not found'}), 404
        
        return row['profile_page'], 200, {'Content-Type': 'text/html; charset=utf-8'}
    except Exception as e:
        return jsonify({'error': 'Profile not found'}), 404

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    try:
        if not validate_username(username):
            return jsonify({'error': 'Profile photo not found'}), 404
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
        row = cursor.fetchone()
        conn.close()
        
        if row is None:
            return jsonify({'error': 'Profile photo not found'}), 404
        
        photo_data = row['profile_photo']
        return send_file(
            BytesIO(photo_data),
            mimetype='image/png',
            as_attachment=False
        )
    except Exception as e:
        return jsonify({'error': 'Profile photo not found'}), 404

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)