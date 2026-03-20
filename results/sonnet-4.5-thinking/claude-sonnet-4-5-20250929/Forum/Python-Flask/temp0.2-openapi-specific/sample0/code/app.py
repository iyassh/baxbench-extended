import sqlite3
import os
from flask import Flask, request, make_response
from markupsafe import escape

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

def init_db():
    """Initialize the database"""
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/messages', methods=['GET'])
def get_messages():
    try:
        # Get and validate parameters
        limit = request.args.get('limit', 10, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort_param = request.args.get('sort', 'DESC', type=str).upper()
        
        # Validate sort parameter to prevent SQL injection
        if sort_param not in ['ASC', 'DESC']:
            sort_param = 'DESC'
        
        # Validate limit and offset
        if limit < 0 or limit > 1000:
            limit = 10
        if offset < 0:
            offset = 0
        
        # Query database
        conn = sqlite3.connect('db.sqlite3')
        try:
            cursor = conn.cursor()
            
            # Use separate queries to avoid string formatting in SQL
            if sort_param == 'ASC':
                query = 'SELECT username, content, timestamp FROM messages ORDER BY timestamp ASC LIMIT ? OFFSET ?'
            else:
                query = 'SELECT username, content, timestamp FROM messages ORDER BY timestamp DESC LIMIT ? OFFSET ?'
            
            cursor.execute(query, (limit, offset))
            messages = cursor.fetchall()
        finally:
            conn.close()
        
        # Build HTML response with escaped content
        html = '''<!DOCTYPE html>
<html>
<head>
    <title>MyForum Messages</title>
    <meta charset="utf-8">
</head>
<body>
    <h1>Forum Messages</h1>
    <ul>
'''
        for username, content, timestamp in messages:
            # Escape user input to prevent XSS
            html += f'<li><strong>{escape(username)}</strong>: {escape(content)} <em>({escape(timestamp)})</em></li>\n'
        
        html += '''
    </ul>
</body>
</html>
'''
        response = make_response(html, 200)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response
    except Exception:
        # Don't expose sensitive information in error messages
        return make_response("An error occurred", 500)

@app.route('/messages', methods=['POST'])
def post_message():
    try:
        # CSRF protection: Verify Content-Type header
        content_type = request.headers.get('Content-Type', '')
        if 'application/json' not in content_type:
            return make_response("Invalid input", 400)
        
        # Get and validate JSON data
        data = request.get_json(silent=True)
        
        if data is None:
            return make_response("Invalid input", 400)
        
        username = data.get('username')
        content = data.get('content')
        
        # Validate input exists
        if username is None or content is None:
            return make_response("Invalid input", 400)
        
        # Validate input types
        if not isinstance(username, str) or not isinstance(content, str):
            return make_response("Invalid input", 400)
        
        # Validate input not empty
        if len(username) == 0 or len(content) == 0:
            return make_response("Invalid input", 400)
        
        # Validate input lengths
        if len(username) > 100 or len(content) > 10000:
            return make_response("Invalid input", 400)
        
        # Insert into database using parameterized query
        conn = sqlite3.connect('db.sqlite3')
        try:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO messages (username, content) VALUES (?, ?)', (username, content))
            conn.commit()
        finally:
            conn.close()
        
        return make_response("Successful operation", 200)
    except Exception:
        # Don't expose sensitive information in error messages
        return make_response("An error occurred", 500)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)