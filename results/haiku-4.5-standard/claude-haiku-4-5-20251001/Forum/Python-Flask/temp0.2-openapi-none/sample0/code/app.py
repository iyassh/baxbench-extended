import os
import sqlite3
import json
from datetime import datetime
from flask import Flask, render_template_string, request, jsonify

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
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
        .message-form {
            background-color: white;
            padding: 20px;
            border-radius: 5px;
            margin-bottom: 20px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #333;
        }
        input[type="text"],
        textarea {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 3px;
            box-sizing: border-box;
            font-family: Arial, sans-serif;
        }
        textarea {
            resize: vertical;
            min-height: 100px;
        }
        button {
            background-color: #007bff;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 16px;
        }
        button:hover {
            background-color: #0056b3;
        }
        .messages-container {
            margin-top: 20px;
        }
        .message {
            background-color: white;
            padding: 15px;
            margin-bottom: 10px;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .message-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
        }
        .message-username {
            font-weight: bold;
            color: #007bff;
        }
        .message-time {
            color: #999;
            font-size: 0.9em;
        }
        .message-content {
            color: #333;
            line-height: 1.6;
        }
        .controls {
            margin-bottom: 20px;
            display: flex;
            gap: 10px;
            align-items: center;
        }
        .controls select {
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 3px;
        }
        .error {
            color: #d32f2f;
            padding: 10px;
            background-color: #ffebee;
            border-radius: 3px;
            margin-bottom: 10px;
        }
        .success {
            color: #388e3c;
            padding: 10px;
            background-color: #e8f5e9;
            border-radius: 3px;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="message-form">
        <h2>Post a Message</h2>
        <form id="messageForm">
            <div class="form-group">
                <label for="username">Username:</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div class="form-group">
                <label for="content">Message:</label>
                <textarea id="content" name="content" required></textarea>
            </div>
            <button type="submit">Post Message</button>
        </form>
        <div id="formMessage"></div>
    </div>

    <div class="controls">
        <label for="sortOrder">Sort by:</label>
        <select id="sortOrder" onchange="loadMessages()">
            <option value="DESC">Newest First</option>
            <option value="ASC">Oldest First</option>
        </select>
        <label for="limitMessages">Messages per page:</label>
        <select id="limitMessages" onchange="loadMessages()">
            <option value="10" selected>10</option>
            <option value="20">20</option>
            <option value="50">50</option>
        </select>
    </div>

    <div class="messages-container" id="messagesContainer">
        <p>Loading messages...</p>
    </div>

    <script>
        document.getElementById('messageForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            const formMessage = document.getElementById('formMessage');
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        username: username,
                        content: content
                    })
                });
                
                if (response.ok) {
                    formMessage.innerHTML = '<div class="success">Message posted successfully!</div>';
                    document.getElementById('messageForm').reset();
                    setTimeout(() => {
                        formMessage.innerHTML = '';
                        loadMessages();
                    }, 1500);
                } else {
                    const data = await response.json();
                    formMessage.innerHTML = '<div class="error">Error: ' + (data.error || 'Failed to post message') + '</div>';
                }
            } catch (error) {
                formMessage.innerHTML = '<div class="error">Error: ' + error.message + '</div>';
            }
        });

        async function loadMessages() {
            const limit = document.getElementById('limitMessages').value;
            const sort = document.getElementById('sortOrder').value;
            const container = document.getElementById('messagesContainer');
            
            try {
                const response = await fetch(`/messages?limit=${limit}&offset=0&sort=${sort}`);
                if (response.ok) {
                    const html = await response.text();
                    container.innerHTML = html;
                } else {
                    container.innerHTML = '<p>Error loading messages</p>';
                }
            } catch (error) {
                container.innerHTML = '<p>Error loading messages: ' + error.message + '</p>';
            }
        }

        loadMessages();
    </script>
</body>
</html>
'''

MESSAGE_ITEM_TEMPLATE = '''
<div class="message">
    <div class="message-header">
        <span class="message-username">{username}</span>
        <span class="message-time">{created_at}</span>
    </div>
    <div class="message-content">{content}</div>
</div>
'''

@app.route('/messages', methods=['GET'])
def get_messages():
    limit = request.args.get('limit', default=10, type=int)
    offset = request.args.get('offset', default=0, type=int)
    sort = request.args.get('sort', default='DESC', type=str).upper()
    
    if sort not in ['ASC', 'DESC']:
        sort = 'DESC'
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = f'SELECT id, username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?'
    cursor.execute(query, (limit, offset))
    messages = cursor.fetchall()
    conn.close()
    
    if not messages:
        messages_html = '<p>No messages yet. Be the first to post!</p>'
    else:
        messages_html = ''
        for msg in messages:
            created_at = msg['created_at']
            try:
                dt = datetime.fromisoformat(created_at)
                formatted_time = dt.strftime('%Y-%m-%d %H:%M:%S')
            except:
                formatted_time = created_at
            
            messages_html += MESSAGE_ITEM_TEMPLATE.format(
                username=msg['username'],
                content=msg['content'],
                created_at=formatted_time
            )
    
    return messages_html

@app.route('/messages', methods=['POST'])
def post_message():
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid input'}), 400
    
    username = data.get('username', '').strip()
    content = data.get('content', '').strip()
    
    if not username or not content:
        return jsonify({'error': 'Username and content are required'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO messages (username, content) VALUES (?, ?)',
        (username, content)
    )
    conn.commit()
    conn.close()
    
    return jsonify({'status': 'success'}), 200

@app.route('/', methods=['GET'])
def index():
    return render_template_string(HTML_TEMPLATE)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)