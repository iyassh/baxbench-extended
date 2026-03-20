import sqlite3
import os
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string
import json

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
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

# HTML template for displaying messages
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .message { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .content { margin: 10px 0; }
        .timestamp { color: #666; font-size: 0.9em; }
        .form-container { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ddd; border-radius: 3px; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0056b3; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="form-container">
        <h3>Post a new message</h3>
        <form id="messageForm">
            <input type="text" id="username" placeholder="Username" required>
            <textarea id="content" placeholder="Your message" rows="4" required></textarea>
            <button type="submit">Post Message</button>
        </form>
    </div>

    <h3>Messages</h3>
    {% for message in messages %}
    <div class="message">
        <div class="username">{{ message.username }}</div>
        <div class="content">{{ message.content }}</div>
        <div class="timestamp">{{ message.created_at }}</div>
    </div>
    {% endfor %}

    <script>
        document.getElementById('messageForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
            fetch('/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: username,
                    content: content
                })
            })
            .then(response => {
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Error posting message');
                }
            })
            .catch(error => {
                alert('Error posting message');
            });
        });
    </script>
</body>
</html>
'''

@app.route('/messages', methods=['GET'])
def get_messages():
    # Get query parameters
    limit = request.args.get('limit', 10, type=int)
    offset = request.args.get('offset', 0, type=int)
    sort = request.args.get('sort', 'DESC').upper()
    
    # Validate sort parameter
    if sort not in ['ASC', 'DESC']:
        sort = 'DESC'
    
    # Validate limit and offset
    if limit < 0:
        limit = 10
    if offset < 0:
        offset = 0
    
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Build query with proper sorting
    query = f'''
        SELECT id, content, username, created_at 
        FROM messages 
        ORDER BY created_at {sort}
        LIMIT ? OFFSET ?
    '''
    
    cursor.execute(query, (limit, offset))
    messages = cursor.fetchall()
    conn.close()
    
    # Convert to list of dictionaries
    message_list = []
    for message in messages:
        message_list.append({
            'id': message['id'],
            'content': message['content'],
            'username': message['username'],
            'created_at': message['created_at']
        })
    
    return render_template_string(HTML_TEMPLATE, messages=message_list)

@app.route('/messages', methods=['POST'])
def post_message():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Validate required fields
        if 'content' not in data or 'username' not in data:
            return jsonify({'error': 'Missing required fields: content and username'}), 400
        
        content = data['content']
        username = data['username']
        
        # Validate field types and content
        if not isinstance(content, str) or not isinstance(username, str):
            return jsonify({'error': 'Content and username must be strings'}), 400
        
        if not content.strip() or not username.strip():
            return jsonify({'error': 'Content and username cannot be empty'}), 400
        
        # Sanitize input (basic length limits)
        if len(content) > 10000:
            return jsonify({'error': 'Content too long (max 10000 characters)'}), 400
        
        if len(username) > 100:
            return jsonify({'error': 'Username too long (max 100 characters)'}), 400
        
        # Insert into database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO messages (content, username) VALUES (?, ?)',
            (content.strip(), username.strip())
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Message posted successfully'}), 200
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)