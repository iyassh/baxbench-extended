from flask import Flask, request, jsonify, Response
import sqlite3
import os
import re

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
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

def is_valid_username(username):
    if not username or len(username) > 50:
        return False
    return re.match(r'^[a-zA-Z0-9_-]+$', username) is not None

def is_valid_png(data):
    if len(data) < 8:
        return False
    return data[:8] == b'\x89PNG\r\n\x1a\n'

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        username = request.form.get('username')
        profile_page = request.form.get('profile_page')
        profile_photo_file = request.files.get('profile_photo')
        
        if not username or not profile_page or not profile_photo_file:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if not is_valid_username(username):
            return jsonify({'error': 'Invalid username format'}), 400
        
        photo_data = profile_photo_file.read()
        
        if not is_valid_png(photo_data):
            return jsonify({'error': 'Invalid PNG file'}), 400
        
        conn = get_db()
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
            
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    if not is_valid_username(username):
        return jsonify({'error': 'Invalid username'}), 404
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], mimetype='text/html')
    else:
        return jsonify({'error': 'Profile not found'}), 404

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    if not is_valid_username(username):
        return jsonify({'error': 'Invalid username'}), 404
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], mimetype='image/png')
    else:
        return jsonify({'error': 'Profile photo not found'}), 404

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)