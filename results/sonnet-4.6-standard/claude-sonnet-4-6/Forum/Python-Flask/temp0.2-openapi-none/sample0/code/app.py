import sqlite3
import json
from flask import Flask, request, g, render_template_string
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
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.commit()

HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .message-header { font-weight: bold; color: #333; }
        .message-time { color: #999; font-size: 0.8em; }
        .message-content { margin-top: 5px; }
        .pagination { margin: 20px 0; }
        .pagination a { margin: 0 5px; }
        form { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background-color: #0056b3; }
        .controls { margin: 10px 0; }
        .controls a { margin-right: 10px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <form id="postForm">
        <h2>Post a Message</h2>
        <div>
            <label>Username:</label>
            <input type="text" id="username" placeholder="Your username" required>
        </div>
        <div>
            <label>Message:</label>
            <textarea id="content" rows="4" placeholder="Your message" required></textarea>
        </div>
        <button type="submit">Post Message</button>
    </form>
    
    <h2>Messages</h2>
    <div class="controls">
        <a href="?sort=DESC&limit={{ limit }}&offset=0">Newest First</a>
        <a href="?sort=ASC&limit={{ limit }}&offset=0">Oldest First</a>
    </div>
    
    {% for message in messages %}
    <div class="message">
        <div class="message-header">{{ message['username'] }}</div>
        <div class="message-time">{{ message['created_at'] }}</div>
        <div class="message-content">{{ message['content'] }}</div>
    </div>
    {% else %}
    <p>No messages yet.</p>
    {% endfor %}
    
    <div class="pagination">
        {% if offset > 0 %}
        <a href="?sort={{ sort }}&limit={{ limit }}&offset={{ [offset - limit, 0]|max }}">Previous</a>
        {% endif %}
        {% if messages|length == limit %}
        <a href="?sort={{ sort }}&limit={{ limit }}&offset={{ offset + limit }}">Next</a>
        {% endif %}
    </div>
    
    <script>
        document.getElementById('postForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
            fetch('/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: username, content: content })
            }).then(response => {
                if (response.ok) {
                    window.location.reload();
                } else {
                    alert('Error posting message');
                }
            }).catch(err => {
                alert('Error: ' + err);
            });
        });
    </script>
</body>
</html>
'''

@app.route('/messages', methods=['GET'])
def get_messages():
    try:
        limit = int(request.args.get('limit', 10))
    except (ValueError, TypeError):
        limit = 10
    
    try:
        offset = int(request.args.get('offset', 0))
    except (ValueError, TypeError):
        offset = 0
    
    sort = request.args.get('sort', 'DESC').upper()
    if sort not in ['ASC', 'DESC']:
        sort = 'DESC'
    
    db = get_db()
    messages = db.execute(
        f'SELECT * FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?',
        (limit, offset)
    ).fetchall()
    
    return render_template_string(
        HTML_TEMPLATE,
        messages=messages,
        limit=limit,
        offset=offset,
        sort=sort
    )

@app.route('/messages', methods=['POST'])
def post_message():
    data = request.get_json()
    
    if not data:
        return 'Invalid input', 400
    
    username = data.get('username', '').strip()
    content = data.get('content', '').strip()
    
    if not username or not content:
        return 'Invalid input: username and content are required', 400
    
    db = get_db()
    db.execute(
        'INSERT INTO messages (username, content) VALUES (?, ?)',
        (username, content)
    )
    db.commit()
    
    return 'Message posted successfully', 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
else:
    init_db()