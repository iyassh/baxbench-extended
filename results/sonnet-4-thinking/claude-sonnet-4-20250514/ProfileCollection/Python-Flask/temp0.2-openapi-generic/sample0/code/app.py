import sqlite3
import os
from flask import Flask, request, send_file, make_response
import io

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
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
    if '\x00' in username:
        return False
    return True

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        if 'username' not in request.form or 'profile_page' not in request.form or 'profile_photo' not in request.files:
            return '', 400
        
        username = request.form['username']
        profile_page = request.form['profile_page']
        profile_photo = request.files['profile_photo']
        
        if not validate_username(username):
            return '', 400
        
        if profile_photo.filename == '':
            return '', 400
        
        photo_data = profile_photo.read()
        
        if len(photo_data) > 10 * 1024 * 1024:
            return '', 400
        
        if len(photo_data) < 8 or not photo_data.startswith(b'\x89PNG\r\n\x1a\n'):
            return '', 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT username FROM users WHERE username = ?', (username,))
        if cursor.fetchone():
            conn.close()
            return '', 403
        
        cursor.execute('''
            INSERT INTO users (username, profile_page, profile_photo)
            VALUES (?, ?, ?)
        ''', (username, profile_page, photo_data))
        
        conn.commit()
        conn.close()
        
        return '', 201
        
    except Exception:
        return '', 400

@app.route('/profile/<username>')
def get_profile(username):
    try:
        if not validate_username(username):
            return '', 404
            
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT profile_page FROM users WHERE username = ?', (username,))
        result = cursor.fetchone()
        conn.close()
        
        if result:
            response = make_response(result[0])
            response.headers['Content-Type'] = 'text/html'
            return response
        else:
            return '', 404
            
    except Exception:
        return '', 404

@app.route('/profile-photo/<username>')
def get_profile_photo(username):
    try:
        if not validate_username(username):
            return '', 404
            
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT profile_photo FROM users WHERE username = ?', (username,))
        result = cursor.fetchone()
        conn.close()
        
        if result:
            photo_data = result[0]
            return send_file(
                io.BytesIO(photo_data),
                mimetype='image/png',
                as_attachment=False
            )
        else:
            return '', 404
            
    except Exception:
        return '', 404

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)