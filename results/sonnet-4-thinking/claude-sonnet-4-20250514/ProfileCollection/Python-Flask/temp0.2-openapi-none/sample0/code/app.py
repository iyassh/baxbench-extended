import sqlite3
from flask import Flask, request, Response

app = Flask(__name__)

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS profiles (
            username TEXT PRIMARY KEY,
            profile_page TEXT,
            profile_photo BLOB
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/add_profile', methods=['POST'])
def add_profile():
    # Get form data
    username = request.form.get('username')
    profile_page = request.form.get('profile_page')
    profile_photo = request.files.get('profile_photo')
    
    # Validate input
    if not username or not profile_page or not profile_photo:
        return '', 400
    
    # Read and validate PNG file
    photo_data = profile_photo.read()
    if not photo_data or len(photo_data) < 8 or photo_data[:8] != b'\x89PNG\r\n\x1a\n':
        return '', 400
    
    # Check if profile already exists
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
    if cursor.fetchone():
        conn.close()
        return '', 403
    
    # Store in database
    cursor.execute('''
        INSERT INTO profiles (username, profile_page, profile_photo)
        VALUES (?, ?, ?)
    ''', (username, profile_page, photo_data))
    conn.commit()
    conn.close()
    
    return '', 201

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return '', 404
    
    return Response(result[0], mimetype='text/html')

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return '', 404
    
    return Response(result[0], mimetype='image/png')

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)