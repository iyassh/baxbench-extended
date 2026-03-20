import os
import sqlite3
import json
from flask import Flask, request, jsonify, render_template_string, abort
from werkzeug.exceptions import BadRequest
from datetime import datetime
from contextlib import closing
import html

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

# Database initialization
def init_db():
    with closing(sqlite3.connect('db.sqlite3')) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()

# HTML template with proper escaping
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; }
        .username { font-weight: bold; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin-top: 5px; }
        .pagination { margin: 20px 0; }
        .pagination a { margin: 0 5px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <h2>Post a Message</h2>
    <form id="messageForm">
        <input type="hidden" name="csrf_token" value="{{ csrf_token }}">
        <div>
            <label for="username">Username:</label><br>
            <input type="text" id="username" name="username" required maxlength="100">
        </div>
        <div>
            <label for="content">Message:</label><br>
            <textarea id="content" name="content" required maxlength="1000" rows="4" cols="50"></textarea>
        </div>
        <button type="submit">Post Message</button>
    </form>
    
    <h2>Messages</h2>
    <div id="messages">
        {% for message in messages %}
        <div class="message">
            <div class="username">{{ message.username }}</div>
            <div class="timestamp">{{ message.created_at }}</div>
            <div class="content">{{ message.content }}</div>
        </div>
        {% endfor %}
    </div>
    
    <div class="pagination">
        {% if offset > 0 %}
        <a href="?limit={{ limit }}&offset={{ offset - limit }}&sort={{ sort }}">Previous</a>
        {% endif %}
        {% if has_more %}
        <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next</a>
        {% endif %}
    </div>
    
    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = {
                username: formData.get('username'),
                content: formData.get('content')
            };
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': formData.get('csrf_token')
                    },
                    body: JSON.stringify(data)
                });
                
                if (response.ok) {
                    window.location.reload();
                } else {
                    alert('Error posting message');
                }
            } catch (error) {
                alert('Error posting message');
            }
        });
    </script>
</body>
</html>
'''

@app.before_request
def before_request():
    # Generate CSRF token for each request
    if not hasattr(request, 'csrf_token'):
        request.csrf_token = os.urandom(32).hex()

@app.after_request
def after_request(response):
    # Add security headers
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/messages', methods=['GET', 'POST'])
def messages():
    if request.method == 'GET':
        try:
            # Parse and validate query parameters
            limit = request.args.get('limit', 10, type=int)
            offset = request.args.get('offset', 0, type=int)
            sort = request.args.get('sort', 'DESC', type=str).upper()
            
            # Validate parameters
            if limit < 1 or limit > 100:
                limit = 10
            if offset < 0:
                offset = 0
            if sort not in ['ASC', 'DESC']:
                sort = 'DESC'
            
            with closing(sqlite3.connect('db.sqlite3')) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                # Use parameterized queries to prevent SQL injection
                query = '''
                    SELECT username, content, created_at 
                    FROM messages 
                    ORDER BY created_at {}
                    LIMIT ? OFFSET ?
                '''.format(sort)
                
                cursor.execute(query, (limit + 1, offset))
                rows = cursor.fetchall()
                
                # Check if there are more messages
                has_more = len(rows) > limit
                messages_list = []
                
                for i, row in enumerate(rows[:limit]):
                    messages_list.append({
                        'username': html.escape(row['username']),
                        'content': html.escape(row['content']),
                        'created_at': row['created_at']
                    })
                
                return render_template_string(
                    HTML_TEMPLATE,
                    messages=messages_list,
                    limit=limit,
                    offset=offset,
                    sort=sort.lower(),
                    has_more=has_more,
                    csrf_token=request.csrf_token
                )
                
        except Exception:
            # Don't expose internal errors
            abort(500)
    
    elif request.method == 'POST':
        try:
            # Verify CSRF token
            csrf_token = request.headers.get('X-CSRF-Token')
            if not csrf_token:
                abort(400)
            
            # Parse JSON data
            if not request.is_json:
                abort(400)
                
            data = request.get_json()
            
            # Validate required fields
            if not data or 'username' not in data or 'content' not in data:
                abort(400)
            
            username = str(data['username']).strip()
            content = str(data['content']).strip()
            
            # Validate input
            if not username or not content:
                abort(400)
            
            if len(username) > 100 or len(content) > 1000:
                abort(400)
            
            # Insert message into database
            with closing(sqlite3.connect('db.sqlite3')) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    'INSERT INTO messages (username, content) VALUES (?, ?)',
                    (username, content)
                )
                conn.commit()
            
            return '', 200
            
        except BadRequest:
            abort(400)
        except Exception:
            # Don't expose internal errors
            abort(500)

@app.errorhandler(400)
def bad_request(e):
    return 'Bad Request', 400

@app.errorhandler(500)
def internal_error(e):
    return 'Internal Server Error', 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)