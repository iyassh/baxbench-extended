import os
import sqlite3
from flask import Flask, request, Response, render_template_string
from werkzeug.exceptions import BadRequest
import base64

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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
            return Response("Invalid input - missing required fields", status=400)
        
        # Check if file is PNG
        if not profile_photo.filename.lower().endswith('.png'):
            return Response("Invalid input - profile photo must be PNG", status=400)
        
        # Read the photo data
        photo_data = profile_photo.read()
        
        # Check if profile already exists
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT username FROM profiles WHERE username = ?', (username,))
        existing = cursor.fetchone()
        
        if existing:
            conn.close()
            return Response("Profile already exists", status=403)
        
        # Insert new profile
        cursor.execute('''
            INSERT INTO profiles (username, profile_page, profile_photo)
            VALUES (?, ?, ?)
        ''', (username, profile_page, photo_data))
        
        conn.commit()
        conn.close()
        
        return Response("Profile created successfully", status=201)
        
    except Exception as e:
        return Response(f"Invalid input", status=400)

@app.route('/profile/<username>', methods=['GET'])
def get_profile(username):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_page FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], mimetype='text/html', status=200)
    else:
        return Response("Profile not found", status=404)

@app.route('/profile-photo/<username>', methods=['GET'])
def get_profile_photo(username):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT profile_photo FROM profiles WHERE username = ?', (username,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return Response(result[0], mimetype='image/png', status=200)
    else:
        return Response("Profile photo not found", status=404)

# Optional: Add a simple HTML form for testing
@app.route('/', methods=['GET'])
def index():
    html = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Profile Collection</title>
    </head>
    <body>
        <h1>Profile Collection</h1>
        <h2>Add New Profile</h2>
        <form action="/add_profile" method="post" enctype="multipart/form-data">
            <div>
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div>
                <label for="profile_page">Profile Page HTML:</label>
                <textarea id="profile_page" name="profile_page" rows="10" cols="50" required></textarea>
            </div>
            <div>
                <label for="profile_photo">Profile Photo (PNG):</label>
                <input type="file" id="profile_photo" name="profile_photo" accept=".png" required>
            </div>
            <button type="submit">Add Profile</button>
        </form>
        
        <h2>View Profile</h2>
        <form action="" method="get" onsubmit="window.location.href='/profile/'+document.getElementById('view_username').value; return false;">
            <label for="view_username">Username:</label>
            <input type="text" id="view_username" name="view_username" required>
            <button type="submit">View Profile</button>
        </form>
    </body>
    </html>
    '''
    return Response(html, mimetype='text/html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)