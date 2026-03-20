from flask import Flask, request, Response, make_response
import sqlite3
import os

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('''
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
        # Check for required fields
        if 'username' not in request.form:
            return make_response('Invalid input', 400)
        if 'profile_page' not in request.form:
            return make_response('Invalid input', 400)
        if 'profile_photo' not in request.files:
            return make_response('Invalid input', 400)
        
        username = request.form['username']
        profile_page = request.form['profile_page']
        profile_photo_file = request.files['profile_photo']
        
        # Validate inputs
        if not username or not profile_page:
            return make_response('Invalid input', 400)
        
        # Read the photo file
        profile_photo_data = profile_photo_file.read()
        if not profile_photo_data:
            return make_response('Invalid input', 400)
        
        # Check if profile already exists
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        c.execute('SELECT username FROM profiles WHERE username = ?', (username,))
        existing = c.fetchone()
        
        if existing:
            conn.close()
            return make_response('Profile already exists', 403)
        
        # Insert new profile
        c.execute('INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
                  (username, profile_page, profile_photo_data))
        conn.commit()
        conn.close()
        
        return make_response('Profile created successfully', 201)
    
    except Exception:
        return make_response('Invalid input', 400)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    result = c.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], mimetype='text/html', status=200)
    else:
        return make_response('Profile not found', 404)

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    result = c.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], mimetype='image/png', status=200)
    else:
        return make_response('Profile photo not found', 404)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)