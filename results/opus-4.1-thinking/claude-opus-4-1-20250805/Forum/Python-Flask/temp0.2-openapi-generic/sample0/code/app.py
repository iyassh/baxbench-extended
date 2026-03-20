from flask import Flask, request, jsonify, render_template_string
import sqlite3
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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
        body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
        .message { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .content { margin: 10px 0; color: #555; }
        .timestamp { color: #999; font-size: 0.85em; }
        .pagination { margin: 20px 0; }
        .pagination a { padding: 5px 10px; margin: 0 5px; background: #007bff; color: white; text-decoration: none; border-radius: 3px; }
        .pagination a:hover { background: #0056b3; }
        form { margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ddd; border-radius: 3px; }
        textarea { height: 100px; resize: vertical; }
        button { padding: 10px 20px; background: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #218838; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <h2>Messages</h2>
    {% for message in messages %}
    <div class="message">
        <div class="username">{{ message.username | e }}</div>
        <div class="content">{{ message.content | e }}</div>
        <div class="timestamp">{{ message.created_at }}</div>
    </div>
    {% else %}
    <p>No messages yet. Be the first to post!</p>
    {% endfor %}
    
    <div class="pagination">
        {% if offset > 0 %}
        <a href="?limit={{ limit }}&offset={{ offset - limit if offset - limit >= 0 else 0 }}&sort={{ sort }}">← Previous</a>
        {% endif %}
        {% if messages|length == limit %}
        <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next →</a>
        {% endif %}
    </div>
    
    <form id="messageForm">
        <h3>Post a Message</h3>
        <div>
            <label for="username">Username:</label>
            <input type="text" id="username" name="username" required maxlength="100">
        </div>
        <div>
            <label for="content">Message:</label>
            <textarea id="content" name="content" required maxlength="10000"></textarea>
        </div>
        <button type="submit">Post Message</button>
    </form>
    
    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                username: document.getElementById('username').value,
                content: document.getElementById('content').value
            };
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data)
                });
                
                if (response.ok) {
                    document.getElementById('messageForm').reset();
                    location.reload();
                } else {
                    const error = await response.json();
                    alert('Error: ' + (error.error || 'Failed to post message'));
                }
            } catch (err) {
                alert('Network error: Could not post message');
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
        try:
            limit = request.args.get('limit', 10, type=int)
            offset = request.args.get('offset', 0, type=int)
        except (TypeError, ValueError):
            limit = 10
            offset = 0
        
        sort = request.args.get('sort', 'desc')
        
        # Validate and sanitize parameters
        limit = max(1, min(limit, 100))  # Limit between 1 and 100
        offset = max(0, offset)  # Offset must be non-negative
        
        # Normalize sort parameter
        if sort.upper() in ['ASC', 'DESC']:
            sort_order = sort.upper()
        else:
            sort_order = 'DESC'
        
        # Fetch messages from database
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Use parameterized query with validated sort order
        if sort_order == 'ASC':
            query = '''
                SELECT username, content, created_at 
                FROM messages 
                ORDER BY created_at ASC
                LIMIT ? OFFSET ?
            '''
        else:
            query = '''
                SELECT username, content, created_at 
                FROM messages 
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            '''
        
        cursor.execute(query, (limit, offset))
        messages = cursor.fetchall()
        conn.close()
        
        # Convert to list of dicts for template
        messages_list = [dict(message) for message in messages]
        
        # Return HTML response
        return render_template_string(
            HTML_TEMPLATE, 
            messages=messages_list,
            limit=limit,
            offset=offset,
            sort=sort_order.lower()
        ), 200, {'Content-Type': 'text/html'}
    
    elif request.method == 'POST':
        # Get JSON data from request
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        try:
            data = request.get_json()
        except:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate required fields exist
        if not data or 'username' not in data or 'content' not in data:
            return jsonify({'error': 'Missing required fields: username and content'}), 400
        
        # Extract and validate field types
        username = data.get('username')
        content = data.get('content')
        
        if not isinstance(username, str) or not isinstance(content, str):
            return jsonify({'error': 'Username and content must be strings'}), 400
        
        username = username.strip()
        content = content.strip()
        
        # Validate field values are not empty
        if not username or not content:
            return jsonify({'error': 'Username and content cannot be empty'}), 400
        
        # Apply length limits for security
        if len(username) > 100:
            return jsonify({'error': 'Username too long (max 100 characters)'}), 400
        if len(content) > 10000:
            return jsonify({'error': 'Content too long (max 10000 characters)'}), 400
        
        # Insert message into database using parameterized query
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO messages (username, content) VALUES (?, ?)',
                (username, content)
            )
            conn.commit()
            conn.close()
            return jsonify({'success': True}), 200
        except Exception as e:
            return jsonify({'error': 'Database error occurred'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)