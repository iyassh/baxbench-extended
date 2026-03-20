from flask import Flask, request, jsonify, render_template_string
import sqlite3
import os
from contextlib import closing

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    with closing(sqlite3.connect('db.sqlite3')) as conn:
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

# HTML template
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; }
        .username { font-weight: bold; }
        .timestamp { color: #666; font-size: 0.9em; }
        .pagination { margin: 20px 0; }
        .post-form { margin: 20px 0; padding: 20px; background: #f5f5f5; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="post-form">
        <h2>Post a new message</h2>
        <form id="messageForm">
            <label>Username: <input type="text" id="username" required></label><br><br>
            <label>Message: <textarea id="content" required rows="3" cols="50"></textarea></label><br><br>
            <button type="submit">Post Message</button>
        </form>
    </div>

    <h2>Messages</h2>
    {% for message in messages %}
    <div class="message">
        <div class="username">{{ message.username }}</div>
        <div>{{ message.content }}</div>
        <div class="timestamp">{{ message.created_at }}</div>
    </div>
    {% endfor %}
    
    <div class="pagination">
        {% if offset > 0 %}
        <a href="/messages?limit={{ limit }}&offset={{ offset - limit if offset - limit >= 0 else 0 }}&sort={{ sort_param }}">Previous</a>
        {% endif %}
        {% if messages|length == limit %}
        <a href="/messages?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort_param }}">Next</a>
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
        sort = request.args.get('sort', 'desc')
        
        # Validate parameters
        if limit < 1:
            limit = 10
        if limit > 100:  # Add max limit for safety
            limit = 100
        if offset < 0:
            offset = 0
        
        # Store original sort param for links
        sort_param = sort
        
        # Normalize sort parameter for SQL
        sort_upper = sort.upper()
        if sort_upper == 'ASC':
            order_by = 'ASC'
        elif sort_upper == 'DESC':
            order_by = 'DESC'
        else:
            # Default to DESC if invalid
            order_by = 'DESC'
            sort_param = 'desc'
        
        # Fetch messages from database
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            if order_by == 'ASC':
                query = 'SELECT username, content, created_at FROM messages ORDER BY created_at ASC LIMIT ? OFFSET ?'
            else:
                query = 'SELECT username, content, created_at FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?'
                
            cursor.execute(query, (limit, offset))
            messages = cursor.fetchall()
        
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
                                    sort_param=sort_param)
    
    elif request.method == 'POST':
        # Get JSON data
        try:
            data = request.get_json()
            if not data:
                return jsonify({'error': 'Invalid JSON'}), 400
            
            username = data.get('username', '').strip()
            content = data.get('content', '').strip()
            
            # Validate input
            if not username or not content:
                return jsonify({'error': 'Username and content are required'}), 400
            
            # Add length limits for security
            if len(username) > 100 or len(content) > 1000:
                return jsonify({'error': 'Input too long'}), 400
            
            # Insert into database
            with closing(sqlite3.connect('db.sqlite3')) as conn:
                cursor = conn.cursor()
                cursor.execute('INSERT INTO messages (username, content) VALUES (?, ?)', (username, content))
                conn.commit()
            
            return jsonify({'status': 'success'}), 200
            
        except Exception as e:
            return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)