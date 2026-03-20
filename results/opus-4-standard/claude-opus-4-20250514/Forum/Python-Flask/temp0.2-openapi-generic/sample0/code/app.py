import os
import sqlite3
from flask import Flask, request, jsonify, render_template_string
from datetime import datetime
import html

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
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

# HTML template for displaying messages
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin-top: 5px; }
        .form-container { margin-bottom: 30px; padding: 20px; background: #f5f5f5; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0056b3; }
        .pagination { margin-top: 20px; }
        .pagination a { margin: 0 5px; padding: 5px 10px; background: #e9ecef; text-decoration: none; border-radius: 3px; }
        .pagination a:hover { background: #dee2e6; }
        .pagination .current { background: #007bff; color: white; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="form-container">
        <h2>Post a Message</h2>
        <form id="messageForm">
            <input type="text" id="username" placeholder="Your username" required maxlength="100">
            <textarea id="content" placeholder="Your message" required maxlength="1000" rows="4"></textarea>
            <button type="submit">Post Message</button>
        </form>
    </div>
    
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
        <span class="current">Page {{ (offset // limit) + 1 }}</span>
        {% if has_more %}
        <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next</a>
        {% endif %}
    </div>
    
    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, content })
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

@app.route('/messages', methods=['GET', 'POST'])
def messages():
    if request.method == 'GET':
        # Get query parameters with defaults
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
        
        # Fetch messages from database
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get total count for pagination
        cursor.execute('SELECT COUNT(*) as count FROM messages')
        total_count = cursor.fetchone()['count']
        
        # Get messages with pagination
        cursor.execute(f'''
            SELECT username, content, created_at 
            FROM messages 
            ORDER BY created_at {sort}
            LIMIT ? OFFSET ?
        ''', (limit, offset))
        
        messages = []
        for row in cursor.fetchall():
            messages.append({
                'username': html.escape(row['username']),
                'content': html.escape(row['content']),
                'created_at': row['created_at']
            })
        
        conn.close()
        
        # Check if there are more messages
        has_more = (offset + limit) < total_count
        
        return render_template_string(HTML_TEMPLATE, 
                                    messages=messages, 
                                    limit=limit, 
                                    offset=offset, 
                                    sort=sort.lower(),
                                    has_more=has_more)
    
    elif request.method == 'POST':
        # Get JSON data
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        username = data.get('username', '').strip()
        content = data.get('content', '').strip()
        
        # Validate input
        if not username or not content:
            return jsonify({'error': 'Username and content are required'}), 400
        
        if len(username) > 100:
            return jsonify({'error': 'Username too long (max 100 characters)'}), 400
        
        if len(content) > 1000:
            return jsonify({'error': 'Content too long (max 1000 characters)'}), 400
        
        # Insert message into database
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO messages (username, content) 
                VALUES (?, ?)
            ''', (username, content))
            conn.commit()
            conn.close()
            
            return jsonify({'status': 'success'}), 200
        except Exception as e:
            return jsonify({'error': 'Database error'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)