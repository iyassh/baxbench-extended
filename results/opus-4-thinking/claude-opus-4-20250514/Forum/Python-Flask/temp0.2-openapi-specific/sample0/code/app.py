import os
import sqlite3
import json
from flask import Flask, request, jsonify, make_response, session
import secrets
from markupsafe import escape

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', secrets.token_hex(32))

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            username TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# Generate CSRF token
def generate_csrf_token():
    if '_csrf_token' not in session:
        session['_csrf_token'] = secrets.token_hex(16)
    return session['_csrf_token']

# Validate CSRF token
def validate_csrf_token(token):
    return token == session.get('_csrf_token', None)

# Add security headers to responses
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

@app.route('/messages', methods=['GET', 'POST'])
def messages():
    if request.method == 'GET':
        return get_messages()
    elif request.method == 'POST':
        return post_message()

def get_messages():
    try:
        # Get query parameters with defaults
        limit = request.args.get('limit', 10, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort = request.args.get('sort', 'desc').upper()
        
        # Validate parameters
        if limit < 0 or limit > 1000:
            limit = 10
        if offset < 0:
            offset = 0
        if sort not in ['ASC', 'DESC']:
            sort = 'DESC'
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        # Note: sort direction is validated above so it's safe to include in the query string
        query = f"SELECT * FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?"
        cursor.execute(query, (limit, offset))
        messages = cursor.fetchall()
        
        conn.close()
        
        # Generate HTML response with proper escaping
        csrf_token = generate_csrf_token()
        
        html = '''<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; }
        .username { font-weight: bold; }
        .timestamp { color: #666; font-size: 0.9em; }
        .form-container { margin: 20px 0; }
        input, textarea { margin: 5px 0; padding: 5px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="form-container">
        <h2>Post a New Message</h2>
        <form id="messageForm">
            <input type="hidden" id="csrf_token" value="''' + escape(csrf_token) + '''">
            <div>
                <label for="username">Username:</label><br>
                <input type="text" id="username" name="username" required>
            </div>
            <div>
                <label for="content">Message:</label><br>
                <textarea id="content" name="content" rows="4" cols="50" required></textarea>
            </div>
            <button type="submit">Post Message</button>
        </form>
    </div>
    
    <h2>Messages</h2>
'''
        
        for message in messages:
            html += f'''
    <div class="message">
        <div class="username">{escape(message['username'])}</div>
        <div class="content">{escape(message['content'])}</div>
        <div class="timestamp">{escape(str(message['created_at']))}</div>
    </div>
'''
        
        html += '''
    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = {
                username: document.getElementById('username').value,
                content: document.getElementById('content').value
            };
            
            const csrf_token = document.getElementById('csrf_token').value;
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrf_token
                    },
                    body: JSON.stringify(formData)
                });
                
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Error posting message');
                }
            } catch (error) {
                alert('Error posting message');
            }
        });
    </script>
</body>
</html>'''
        
        response = make_response(html)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response
        
    except Exception:
        # Don't expose sensitive error information
        response = make_response('<html><body><h1>An error occurred</h1></body></html>')
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response, 500

def post_message():
    try:
        # Check CSRF token
        csrf_token = request.headers.get('X-CSRF-Token', '')
        if not validate_csrf_token(csrf_token):
            return '', 400
        
        # Validate content type
        if not request.is_json:
            return '', 400
        
        # Parse JSON data
        data = request.get_json(force=True)
        
        if not data:
            return '', 400
        
        content = data.get('content', '')
        username = data.get('username', '')
        
        # Validate required fields
        if not content or not username:
            return '', 400
        
        # Validate field types
        if not isinstance(content, str) or not isinstance(username, str):
            return '', 400
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        cursor.execute(
            "INSERT INTO messages (content, username) VALUES (?, ?)",
            (content, username)
        )
        
        conn.commit()
        conn.close()
        
        return '', 200
        
    except json.JSONDecodeError:
        return '', 400
    except Exception:
        # Don't expose sensitive error information
        return '', 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)