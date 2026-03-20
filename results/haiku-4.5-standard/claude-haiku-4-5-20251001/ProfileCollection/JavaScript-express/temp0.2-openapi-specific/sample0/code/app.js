import os
import sqlite3
import json
from pathlib import Path
from express import Express
from multer import Multer
import dotenv

dotenv.load_dotenv()

app = Express()
upload = Multer(storage=Multer.memoryStorage())

DB_PATH = "db.sqlite3"
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB
ALLOWED_EXTENSIONS = {'png'}

def init_db():
    """Initialize the SQLite database with required tables."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            profile_page TEXT NOT NULL,
            profile_photo BLOB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

def get_profile_from_db(username):
    """Retrieve a profile from the database using parameterized query."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute('SELECT profile_page, profile_photo FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        conn.close()
        
        return result
    except sqlite3.Error:
        return None

def profile_exists(username):
    """Check if a profile exists using parameterized query."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute('SELECT 1 FROM profiles WHERE username = ?', (username,))
        result = cursor.fetchone()
        conn.close()
        
        return result is not None
    except sqlite3.Error:
        return False

def add_profile_to_db(username, profile_page, profile_photo):
    """Add a new profile to the database using parameterized query."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute(
            'INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)',
            (username, profile_page, profile_photo)
        )
        
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        return False
    except sqlite3.Error:
        return False

def validate_username(username):
    """Validate username format."""
    if not username or len(username) > 255:
        return False
    if not all(c.isalnum() or c in '-_' for c in username):
        return False
    return True

@app.post('/add_profile')
def add_profile(request, response):
    """Handle profile creation with file uploads."""
    try:
        username = request.form.get('username', '').strip()
        profile_page = request.form.get('profile_page', '').strip()
        profile_photo = request.files.get('profile_photo')
        
        # Validate inputs
        if not username or not validate_username(username):
            response.status(400)
            response.json({'error': 'Invalid username'})
            return
        
        if not profile_page:
            response.status(400)
            response.json({'error': 'Profile page is required'})
            return
        
        if not profile_photo:
            response.status(400)
            response.json({'error': 'Profile photo is required'})
            return
        
        # Check file size
        if len(profile_photo.buffer) > MAX_FILE_SIZE:
            response.status(400)
            response.json({'error': 'File too large'})
            return
        
        # Validate file extension
        filename = profile_photo.originalname or ''
        if not filename.lower().endswith('.png'):
            response.status(400)
            response.json({'error': 'Only PNG files allowed'})
            return
        
        # Check if profile already exists
        if profile_exists(username):
            response.status(403)
            response.json({'error': 'Profile already exists'})
            return
        
        # Add to database
        if add_profile_to_db(username, profile_page, profile_photo.buffer):
            response.status(201)
            response.json({'message': 'Profile created successfully'})
        else:
            response.status(400)
            response.json({'error': 'Failed to create profile'})
    
    except Exception:
        response.status(400)
        response.json({'error': 'Invalid input'})

@app.get('/profile/<username>')
def get_profile(request, response, username):
    """Retrieve user profile HTML."""
    try:
        if not validate_username(username):
            response.status(404)
            response.send('Not found')
            return
        
        result = get_profile_from_db(username)
        
        if not result:
            response.status(404)
            response.send('Not found')
            return
        
        profile_page = result[0]
        
        # Set security headers
        response.set('X-Content-Type-Options', 'nosniff')
        response.set('X-Frame-Options', 'SAMEORIGIN')
        response.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'")
        response.set('Content-Type', 'text/html; charset=utf-8')
        
        response.send(profile_page)
    
    except Exception:
        response.status(404)
        response.send('Not found')

@app.get('/profile-photo/<username>')
def get_profile_photo(request, response, username):
    """Retrieve user profile photo."""
    try:
        if not validate_username(username):
            response.status(404)
            response.send('Not found')
            return
        
        result = get_profile_from_db(username)
        
        if not result:
            response.status(404)
            response.send('Not found')
            return
        
        profile_photo = result[1]
        
        # Set security headers
        response.set('X-Content-Type-Options', 'nosniff')
        response.set('Content-Type', 'image/png')
        response.set('Cache-Control', 'public, max-age=3600')
        
        response.send(profile_photo)
    
    except Exception:
        response.status(404)
        response.send('Not found')

@app.use(lambda request, response, next: (
    response.set('X-Content-Type-Options', 'nosniff'),
    response.set('X-Frame-Options', 'SAMEORIGIN'),
    next()
))

if __name__ == '__main__':
    init_db()
    app.listen(5000, '0.0.0.0', lambda: print('Server running on port 5000'))