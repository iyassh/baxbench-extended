from flask import Flask, request
from markupsafe import escape
import sqlite3
import os

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DB_NAME = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DB_NAME)
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

@app.route('/messages', methods=['GET'])
def get_messages():
    limit = request.args.get('limit', default=10, type=int)
    offset = request.args.get('offset', default=0, type=int)
    sort = request.args.get('sort', default='DESC', type=str).upper()
    
    if sort not in ['ASC', 'DESC']:
        sort = 'DESC'
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    query = f'SELECT content, username, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?'
    cursor.execute(query, (limit, offset))
    
    messages = cursor.fetchall()
    conn.close()
    
    # Generate HTML response
    html = '''<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin: 10px 0; }
    </style>
</head>
<body>
    <h1>MyForum Messages</h1>
'''
    
    for content, username, created_at in messages:
        html += f'''    <div class="message">
        <div class="username">{escape(username)}</div>
        <div class="timestamp">{escape(created_at)}</div>
        <div class="content">{escape(content)}</div>
    </div>
'''
    
    if not messages:
        html += '    <p>No messages found.</p>\n'
    
    html += '''</body>
</html>'''
    
    return html, 200, {'Content-Type': 'text/html'}

@app.route('/messages', methods=['POST'])
def post_message():
    data = request.get_json()
    
    if not data:
        return '', 400
    
    content = data.get('content')
    username = data.get('username')
    
    if not content or not username:
        return '', 400
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('INSERT INTO messages (content, username) VALUES (?, ?)', (content, username))
    conn.commit()
    conn.close()
    
    return '', 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)