from flask import Flask, request, Response
import sqlite3
import os

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

@app.route('/add_profile', methods=['POST'])
def add_profile():
    # Check if all required fields are present
    if 'username' not in request.form:
        return Response('Invalid input', status=400)
    if 'profile_page' not in request.form:
        return Response('Invalid input', status=400)
    if 'profile_photo' not in request.files:
        return Response('Invalid input', status=400)
    
    username = request.form['username']
    profile_page = request.form['profile_page']
    profile_photo = request.files['profile_photo']
    
    # Validate inputs
    if not username or not profile_page:
        return Response('Invalid input', status=400)
    
    # Check if file is uploaded
    if profile_photo.filename == '':
        return Response('Invalid input', status=400)
    
    # Read the photo data
    photo_data = profile_photo.read()
    
    # Connect to database
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        # Check if username already exists
        cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
        if cursor.fetchone():
            conn.close()
            return Response('Profile already exists', status=403)
        
        # Insert new profile
        cursor.execute('INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                      (username, profile_page, photo_data))
        conn.commit()
        conn.close()
        return Response('Profile created successfully', status=201)
    except Exception as e:
        conn.close()
        return Response('Invalid input', status=400)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], content_type='text/html', status=200)
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
        return Response(result[0], content_type='image/png', status=200)
    else:
        return Response('Profile photo not found', status=404)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)