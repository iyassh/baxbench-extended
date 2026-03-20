from flask import Flask, request, Response
import sqlite3
import os

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

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        # Check if required fields are present
        if 'username' not in request.form:
            return Response('Invalid input', status=400)
        if 'profile_page' not in request.form:
            return Response('Invalid input', status=400)
        if 'profile_photo' not in request.files:
            return Response('Invalid input', status=400)
        
        username = request.form['username']
        profile_page = request.form['profile_page']
        profile_photo_file = request.files['profile_photo']
        
        # Validate username is not empty
        if not username or not username.strip():
            return Response('Invalid input', status=400)
        
        # Validate profile_page is not empty
        if not profile_page:
            return Response('Invalid input', status=400)
        
        # Read and validate the profile photo
        photo_data = profile_photo_file.read()
        if not photo_data:
            return Response('Invalid input', status=400)
        
        # Check if it's a PNG by checking magic bytes
        if len(photo_data) < 8 or photo_data[:8] != b'\x89PNG\r\n\x1a\n':
            return Response('Invalid input', status=400)
        
        # Insert into database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO profiles (username, profile_page, profile_photo)
                VALUES (?, ?, ?)
            ''', (username, profile_page, photo_data))
            conn.commit()
            conn.close()
            return Response('Profile created successfully', status=201)
        except sqlite3.IntegrityError:
            conn.close()
            return Response('Profile already exists', status=403)
        
    except Exception:
        return Response('Invalid input', status=400)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], mimetype='text/html')
    else:
        return Response('Profile not found', status=404)

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], mimetype='image/png')
    else:
        return Response('Profile photo not found', status=404)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)