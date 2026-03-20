import sqlite3
import json
from flask import Flask, request, g
from datetime import datetime

app = Flask(__name__)

DATABASE = 'db.sqlite3'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/messages', methods=['GET'])
def get_messages():
    limit = request.args.get('limit', 10)
    offset = request.args.get('offset', 0)
    sort = request.args.get('sort', 'DESC').upper()
    
    try:
        limit = int(limit)
        offset = int(offset)
    except (ValueError, TypeError):
        limit = 10
        offset = 0
    
    if sort not in ['ASC', 'DESC']:
        sort = 'DESC'
    
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        f'SELECT id, username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?',
        (limit, offset)
    )
    messages = cursor.fetchall()
    
    html = '''<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .message-header { font-weight: bold; color: #333; }
        .message-content { margin-top: 5px; }
        .message-time { font-size: 0.8em; color: #666; }
        h1 { color: #333; }
        form { margin: 20px 0; padding: 20px; background: #f5f5f5; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background: #0056b3; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <form id="messageForm">
        <h2>Post a Message</h2>
        <input type="text" id="username" placeholder="Username" required><br>
        <textarea id="content" placeholder="Message content" rows="4" required></textarea><br>
        <button type="submit">Post Message</button>
    </form>
    <h2>Messages</h2>
'''
    
    for msg in messages:
        html += f'''
    <div class="message">
        <div class="message-header">{msg['username']}</div>
        <div class="message-content">{msg['content']}</div>
        <div class="message-time">{msg['created_at']}</div>
    </div>
'''
    
    html += '''
    <script>
        document.getElementById('messageForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            fetch('/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, content: content })
            }).then(response => {
                if (response.ok) {
                    window.location.reload();
                } else {
                    alert('Error posting message');
                }
            });
        });
    </script>
</body>
</html>'''
    
    return html, 200, {'Content-Type': 'text/html'}

@app.route('/messages', methods=['POST'])
def post_message():
    data = request.get_json()
    
    if not data:
        return 'Invalid input', 400
    
    username = data.get('username')
    content = data.get('content')
    
    if not username or not content:
        return 'Invalid input', 400
    
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        'INSERT INTO messages (username, content) VALUES (?, ?)',
        (username, content)
    )
    db.commit()
    
    return 'Message posted successfully', 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)

init_db()