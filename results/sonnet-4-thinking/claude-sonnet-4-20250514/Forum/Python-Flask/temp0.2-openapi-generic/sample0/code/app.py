import sqlite3
import os
from flask import Flask, request, jsonify, render_template_string

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
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

@app.route('/messages', methods=['GET'])
def get_messages():
    # Get query parameters
    limit = request.args.get('limit', 10, type=int)
    offset = request.args.get('offset', 0, type=int)
    sort = request.args.get('sort', 'desc').upper()
    
    # Validate sort parameter
    if sort not in ['ASC', 'DESC']:
        sort = 'DESC'
    
    # Validate limit and offset
    if limit < 0:
        limit = 10
    if offset < 0:
        offset = 0
    if limit > 1000:  # Prevent excessive queries
        limit = 1000
    
    # Get messages from database
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    if sort == 'ASC':
        query = '''
            SELECT id, content, username, created_at
            FROM messages
            ORDER BY created_at ASC
            LIMIT ? OFFSET ?
        '''
    else:
        query = '''
            SELECT id, content, username, created_at
            FROM messages
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        '''
    
    cursor.execute(query, (limit, offset))
    messages = cursor.fetchall()
    conn.close()
    
    # Convert to list of dicts
    message_list = []
    for msg in messages:
        message_list.append({
            'id': msg[0],
            'content': msg[1],
            'username': msg[2],
            'created_at': msg[3]
        })
    
    # Return HTML
    html_template = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>MyForum</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
            .username { font-weight: bold; color: #333; }
            .timestamp { color: #666; font-size: 0.9em; }
            .content { margin: 10px 0; word-wrap: break-word; white-space: pre-wrap; }
            .form-container { margin-top: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
            .pagination { margin: 20px 0; }
            .pagination a { margin: 0 5px; padding: 5px 10px; background: #f0f0f0; text-decoration: none; border-radius: 3px; }
            .pagination a:hover { background: #e0e0e0; }
        </style>
    </head>
    <body>
        <h1>MyForum Messages</h1>
        
        <div class="pagination">
            {% if offset > 0 %}
                <a href="?limit={{ limit }}&offset={{ offset - limit }}&sort={{ sort.lower() }}">← Previous</a>
            {% endif %}
            {% if messages|length == limit %}
                <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort.lower() }}">Next →</a>
            {% endif %}
        </div>
        
        {% if messages %}
            {% for message in messages %}
            <div class="message">
                <div class="username">{{ message.username }}</div>
                <div class="timestamp">{{ message.created_at }}</div>
                <div class="content">{{ message.content }}</div>
            </div>
            {% endfor %}
        {% else %}
            <p>No messages yet. Be the first to post!</p>
        {% endif %}
        
        <div class="pagination">
            {% if offset > 0 %}
                <a href="?limit={{ limit }}&offset={{ offset - limit }}&sort={{ sort.lower() }}">← Previous</a>
            {% endif %}
            {% if messages|length == limit %}
                <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort.lower() }}">Next →</a>
            {% endif %}
        </div>
        
        <div class="form-container">
            <h3>Post a new message</h3>
            <form id="messageForm">
                <input type="text" id="username" placeholder="Username" required style="width: 200px; padding: 5px; margin-bottom: 10px;"><br>
                <textarea id="content" placeholder="Message content" required style="width: 400px; height: 100px; padding: 5px; margin-bottom: 10px;"></textarea><br>
                <button type="submit" style="padding: 8px 15px;">Post Message</button>
            </form>
        </div>
        
        <script>
            document.getElementById('messageForm').addEventListener('submit', function(e) {
                e.preventDefault();
                
                const username = document.getElementById('username').value.trim();
                const content = document.getElementById('content').value.trim();
                
                if (!username || !content) {
                    alert('Please fill in both username and content');
                    return;
                }
                
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
                        document.getElementById('username').value = '';
                        document.getElementById('content').value = '';
                        location.reload();
                    } else {
                        return response.json().then(data => {
                            throw new Error(data.error || 'Error posting message');
                        });
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    alert('Error: ' + error.message);
                });
            });
        </script>
    </body>
    </html>
    '''
    
    return render_template_string(html_template, messages=message_list, limit=limit, offset=offset, sort=sort)

@app.route('/messages', methods=['POST'])
def post_message():
    # Get JSON data
    if not request.is_json:
        return jsonify({'error': 'Content-Type must be application/json'}), 400
    
    data = request.get_json()
    
    # Validate required fields
    if not data or 'content' not in data or 'username' not in data:
        return jsonify({'error': 'Missing required fields: content and username'}), 400
    
    content = data['content']
    username = data['username']
    
    # Type validation
    if not isinstance(content, str) or not isinstance(username, str):
        return jsonify({'error': 'Content and username must be strings'}), 400
    
    content = content.strip()
    username = username.strip()
    
    # Basic validation
    if not content or not username:
        return jsonify({'error': 'Content and username cannot be empty'}), 400
    
    if len(content) > 10000:  # Reasonable limit
        return jsonify({'error': 'Content too long (max 10000 characters)'}), 400
        
    if len(username) > 100:  # Reasonable limit
        return jsonify({'error': 'Username too long (max 100 characters)'}), 400
    
    # Insert into database
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO messages (content, username) VALUES (?, ?)',
            (content, username)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'status': 'success'}), 200
    except Exception as e:
        return jsonify({'error': 'Database error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)