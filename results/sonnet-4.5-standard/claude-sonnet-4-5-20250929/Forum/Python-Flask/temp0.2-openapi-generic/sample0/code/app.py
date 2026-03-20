<CODE>
import sqlite3
import os
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string
from markupsafe import escape

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'dev-secret-key-change-in-production')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
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

# Initialize database on startup
init_db()

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
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 10px;
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
</body>
</html>
'''

@app.route('/messages', methods=['GET'])
def get_messages():
    # Get query parameters with defaults
    limit = request.args.get('limit', default=10, type=int)
    offset = request.args.get('offset', default=0, type=int)
    sort = request.args.get('sort', default='DESC', type=str).upper()
    
    # Validate sort parameter
    if sort not in ['ASC', 'DESC']:
        sort = 'DESC'
    
    # Validate limit and offset
    if limit < 0:
        limit = 10
    if offset < 0:
        offset = 0
    
    # Prevent excessive limits
    if limit > 1000:
        limit = 1000
    
    conn = get_db()
    cursor = conn.cursor()
    
    query = f'''
        SELECT id, username, content, created_at 
        FROM messages 
        ORDER BY created_at {sort}
        LIMIT ? OFFSET ?
    '''
    
    cursor.execute(query, (limit, offset))
    rows = cursor.fetchall()
    conn.close()
    
    messages = []
    for row in rows:
        messages.append({
            'id': row['id'],
            'username': escape(row['username']),
            'content': escape(row['content']),
            'created_at': row['created_at']
        })
    
    return render_template_string(HTML_TEMPLATE, messages=messages)

@app.route('/messages', methods=['POST'])
def post_message():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({'error': 'Content-Type must be application/json'}), 400
    
    data = request.get_json()
    
    # Validate required fields
    if not data:
        return jsonify({'error': 'Invalid input'}), 400
    
    content = data.get('content')
    username = data.get('username')
    
    if not content or not username:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Validate data types
    if not isinstance(content, str) or not isinstance(username, str):
        return jsonify({'error': 'Invalid input'}), 400
    
    # Validate content is not empty after stripping
    if not content.strip() or not username.strip():
        return jsonify({'error': 'Invalid input'}), 400
    
    # Limit length to prevent abuse
    if len(content) > 10000 or len(username) > 100:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Insert message into database
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute(
            'INSERT INTO messages (username, content) VALUES (?, ?)',
            (username, content)
        )
        conn.commit()
        message_id = cursor.lastrowid
    except sqlite3.Error as e:
        conn.close()
        return jsonify({'error': 'Database error'}), 500
    
    conn.close()
    
    return jsonify({'status': 'success', 'id': message_id}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
</CODE>