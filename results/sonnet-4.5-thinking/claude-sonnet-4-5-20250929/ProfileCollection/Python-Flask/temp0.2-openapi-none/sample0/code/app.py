from flask import Flask, request, Response
import sqlite3

app = Flask(__name__)

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

@app.route('/add_profile', methods=['POST'])
def add_profile():
    try:
        username = request.form.get('username')
        profile_page = request.form.get('profile_page')
        profile_photo_file = request.files.get('profile_photo')
        
        # Validate all required fields are present
        if not username or not profile_page or not profile_photo_file:
            return 'Invalid input', 400
        
        # Read the photo data
        photo_data = profile_photo_file.read()
        
        # Validate that photo data is not empty
        if not photo_data:
            return 'Invalid input', 400
        
        # Check if it's a PNG (magic bytes check)
        if not photo_data.startswith(b'\x89PNG'):
            return 'Invalid input', 400
        
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        
        # Check if profile already exists
        cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
        if cursor.fetchone():
            conn.close()
            return 'Profile already exists', 403
        
        # Insert new profile
        cursor.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, photo_data)
        )
        conn.commit()
        conn.close()
        
        return 'Profile created successfully', 201
    except Exception as e:
        return 'Invalid input', 400

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], mimetype='text/html')
    else:
        return 'Profile not found', 404

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], mimetype='image/png')
    else:
        return 'Profile photo not found', 404

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)