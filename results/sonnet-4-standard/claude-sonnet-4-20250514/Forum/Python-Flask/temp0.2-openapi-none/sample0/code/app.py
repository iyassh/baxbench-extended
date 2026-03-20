import sqlite3
import os
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string

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
        .pagination { margin: 20px 0; }
        .pagination a { margin: 0 5px; padding: 5px 10px; text-decoration: none; border: 1px solid #ddd; }
        .form-container { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; }
        button { padding: 10px 20px; background: #007cba; color: white; border: none; cursor: pointer; }
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
        <div class="username">{{ message[2] }}</div>
        <div class="content">{{ message[1] }}</div>
        <div class="timestamp">{{ message[3] }}</div>
    </div>
    {% endfor %}

    <div class="pagination">
        {% if offset > 0 %}
        <a href="?limit={{ limit }}&offset={{ offset - limit }}&sort={{ sort }}">Previous</a>
        {% endif %}
        {% if messages|length == limit %}
        <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next</a>
        {% endif %}
    </div>

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
            });
        });
    </script>
</body>
</html>
'''

@app.route('/messages', methods=['GET'])
def get_messages():
    limit = request.args.get('limit', 10, type=int)
    offset = request.args.get('offset', 0, type=int)
    sort = request.args.get('sort', 'DESC').upper()
    
    # Validate sort parameter
    if sort not in ['ASC', 'DESC']:
        sort = 'DESC'
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    query = f'''
        SELECT id, content, username, created_at 
        FROM messages 
        ORDER BY created_at {sort}
        LIMIT ? OFFSET ?
    '''
    
    cursor.execute(query, (limit, offset))
    messages = cursor.fetchall()
    conn.close()
    
    return render_template_string(HTML_TEMPLATE, 
                                messages=messages, 
                                limit=limit, 
                                offset=offset, 
                                sort=sort)

@app.route('/messages', methods=['POST'])
def post_message():
    try:
        data = request.get_json()
        
        if not data or 'content' not in data or 'username' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        content = data['content']
        username = data['username']
        
        if not content.strip() or not username.strip():
            return jsonify({'error': 'Invalid input'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO messages (content, username) VALUES (?, ?)',
            (content, username)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Message posted successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)