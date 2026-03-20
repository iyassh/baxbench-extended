from flask import Flask, request, jsonify, render_template_string
import sqlite3
import os
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Initialize database
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
        form { margin: 20px 0; padding: 20px; background: #f5f5f5; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0056b3; }
        .pagination { margin: 20px 0; }
        .pagination a { padding: 5px 10px; margin: 0 5px; text-decoration: none; background: #f0f0f0; border-radius: 3px; }
        .pagination a:hover { background: #ddd; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <form id="messageForm">
        <h3>Post a new message</h3>
        <input type="text" id="username" placeholder="Your username" required>
        <textarea id="content" placeholder="Your message" rows="4" required></textarea>
        <button type="submit">Post Message</button>
    </form>
    
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
        {% if messages|length == limit %}
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
        # Get query parameters
        limit = request.args.get('limit', 10, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort = request.args.get('sort', 'DESC').upper()
        
        # Validate sort parameter
        if sort not in ['ASC', 'DESC']:
            sort = 'DESC'
        
        # Fetch messages from database
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        query = f'''
            SELECT username, content, created_at 
            FROM messages 
            ORDER BY created_at {sort}
            LIMIT ? OFFSET ?
        '''
        
        cursor.execute(query, (limit, offset))
        messages = cursor.fetchall()
        conn.close()
        
        # Convert to list of dicts for template
        messages_list = []
        for msg in messages:
            messages_list.append({
                'username': msg['username'],
                'content': msg['content'],
                'created_at': msg['created_at']
            })
        
        return render_template_string(HTML_TEMPLATE, 
                                    messages=messages_list, 
                                    limit=limit, 
                                    offset=offset, 
                                    sort=sort.lower())
    
    elif request.method == 'POST':
        # Get JSON data
        data = request.get_json()
        
        if not data or 'username' not in data or 'content' not in data:
            return '', 400
        
        username = data.get('username', '').strip()
        content = data.get('content', '').strip()
        
        if not username or not content:
            return '', 400
        
        # Insert message into database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO messages (username, content) 
                VALUES (?, ?)
            ''', (username, content))
            conn.commit()
            conn.close()
            return '', 200
        except Exception as e:
            conn.close()
            return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)