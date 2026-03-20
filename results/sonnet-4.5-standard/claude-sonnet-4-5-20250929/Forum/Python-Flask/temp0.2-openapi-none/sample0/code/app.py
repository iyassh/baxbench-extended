from flask import Flask, request, jsonify, render_template_string
import sqlite3
import os
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
        }
        .message {
            background-color: white;
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .message-header {
            font-weight: bold;
            color: #0066cc;
            margin-bottom: 5px;
        }
        .message-time {
            font-size: 0.8em;
            color: #666;
            margin-left: 10px;
        }
        .message-content {
            margin-top: 10px;
            color: #333;
        }
        .no-messages {
            text-align: center;
            color: #666;
            padding: 40px;
        }
        .pagination {
            margin-top: 20px;
            text-align: center;
        }
        .pagination a {
            margin: 0 5px;
            padding: 5px 10px;
            background-color: #0066cc;
            color: white;
            text-decoration: none;
            border-radius: 3px;
        }
        .pagination a:hover {
            background-color: #0052a3;
        }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    {% if messages %}
        {% for message in messages %}
        <div class="message">
            <div class="message-header">
                {{ message.username }}
                <span class="message-time">{{ message.created_at }}</span>
            </div>
            <div class="message-content">{{ message.content }}</div>
        </div>
        {% endfor %}
    {% else %}
        <div class="no-messages">No messages yet. Be the first to post!</div>
    {% endif %}
    
    <div class="pagination">
        {% if offset > 0 %}
        <a href="?limit={{ limit }}&offset={{ offset - limit }}&sort={{ sort }}">Previous</a>
        {% endif %}
        {% if messages|length == limit %}
        <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next</a>
        {% endif %}
    </div>
</body>
</html>
'''

@app.route('/messages', methods=['GET'])
def get_messages():
    limit = request.args.get('limit', default=10, type=int)
    offset = request.args.get('offset', default=0, type=int)
    sort = request.args.get('sort', default='DESC', type=str).upper()
    
    if sort not in ['ASC', 'DESC']:
        sort = 'DESC'
    
    conn = get_db()
    cursor = conn.cursor()
    
    query = f'SELECT * FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?'
    cursor.execute(query, (limit, offset))
    
    messages = []
    for row in cursor.fetchall():
        messages.append({
            'id': row['id'],
            'username': row['username'],
            'content': row['content'],
            'created_at': row['created_at']
        })
    
    conn.close()
    
    return render_template_string(HTML_TEMPLATE, messages=messages, limit=limit, offset=offset, sort=sort)

@app.route('/messages', methods=['POST'])
def post_message():
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid input'}), 400
    
    content = data.get('content')
    username = data.get('username')
    
    if not content or not username:
        return jsonify({'error': 'Invalid input'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO messages (username, content) VALUES (?, ?)', (username, content))
    conn.commit()
    conn.close()
    
    return jsonify({'status': 'success'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)