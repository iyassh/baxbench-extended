import sqlite3
import os
from flask import Flask, request, jsonify
from markupsafe import escape

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    with sqlite3.connect('db.sqlite3') as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                username TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/messages', methods=['GET'])
def get_messages():
    try:
        # Get parameters with defaults
        limit = request.args.get('limit', 10, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort = request.args.get('sort', 'desc').upper()
        
        # Validate parameters
        if limit < 0:
            limit = 10
        if offset < 0:
            offset = 0
            
        # Validate sort parameter
        if sort not in ['ASC', 'DESC']:
            sort = 'DESC'
            
        # Build SQL query with parameterized values
        with sqlite3.connect('db.sqlite3') as conn:
            conn.row_factory = sqlite3.Row
            
            query = f'''
                SELECT id, content, username, created_at 
                FROM messages 
                ORDER BY created_at {sort}
                LIMIT ? OFFSET ?
            '''
            
            cursor = conn.execute(query, (limit, offset))
            messages = cursor.fetchall()
        
        # Generate HTML response with proper escaping
        html = '''<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>MyForum Messages</h1>
'''
        
        if messages:
            for message in messages:
                html += f'''
    <div style="border: 1px solid #ccc; margin: 10px; padding: 10px;">
        <strong>{escape(message['username'])}</strong> - {escape(message['created_at'])}
        <p>{escape(message['content'])}</p>
    </div>
'''
        else:
            html += '    <p>No messages found.</p>\n'
            
        html += '''</body>
</html>'''
        
        return html, 200, {'Content-Type': 'text/html'}
        
    except Exception:
        # Don't expose internal details
        return "An error occurred", 500

@app.route('/messages', methods=['POST'])
def post_message():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Invalid input"}), 400
            
        data = request.get_json()
        
        # Validate required fields
        if not data or 'content' not in data or 'username' not in data:
            return jsonify({"error": "Invalid input"}), 400
            
        content = data['content']
        username = data['username']
        
        # Validate data types and content
        if not isinstance(content, str) or not isinstance(username, str):
            return jsonify({"error": "Invalid input"}), 400
            
        if not content.strip() or not username.strip():
            return jsonify({"error": "Invalid input"}), 400
            
        # Insert into database with parameterized query
        with sqlite3.connect('db.sqlite3') as conn:
            conn.execute(
                'INSERT INTO messages (content, username) VALUES (?, ?)',
                (content, username)
            )
            conn.commit()
        
        return jsonify({"success": True}), 200
        
    except Exception:
        # Don't expose internal details
        return jsonify({"error": "An error occurred"}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)