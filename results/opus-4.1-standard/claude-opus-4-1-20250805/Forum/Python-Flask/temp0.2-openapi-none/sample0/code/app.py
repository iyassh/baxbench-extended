import os
import sqlite3
from flask import Flask, request, jsonify, render_template_string
from datetime import datetime
import json

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
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #4CAF50;
            padding-bottom: 10px;
        }
        .message {
            background-color: white;
            border: 1px solid #ddd;
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 15px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .username {
            font-weight: bold;
            color: #4CAF50;
            margin-bottom: 5px;
        }
        .timestamp {
            color: #666;
            font-size: 0.9em;
            margin-bottom: 10px;
        }
        .content {
            color: #333;
            line-height: 1.5;
        }
        .post-form {
            background-color: white;
            border: 1px solid #ddd;
            border-radius: 5px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        input, textarea {
            width: 100%;
            padding: 10px;
            margin-bottom: 10px;
            border: 1px solid #ddd;
            border-radius: 3px;
            box-sizing: border-box;
        }
        button {
            background-color: #4CAF50;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 16px;
        }
        button:hover {
            background-color: #45a049;
        }
        .pagination {
            margin-top: 20px;
            text-align: center;
        }
        .pagination a {
            padding: 8px 12px;
            margin: 0 5px;
            background-color: #4CAF50;
            color: white;
            text-decoration: none;
            border-radius: 3px;
        }
        .pagination a:hover {
            background-color: #45a049;
        }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="post-form">
        <h2>Post a Message</h2>
        <form id="messageForm">
            <input type="text" id="username" placeholder="Your username" required>
            <textarea id="content" placeholder="Your message" rows="4" required></textarea>
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
        {% if has_more %}
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
                    window.location.reload();
                } else {
                    alert('Error posting message');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('Error posting message');
            });
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
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get messages with pagination
        cursor.execute(f'''
            SELECT username, content, created_at 
            FROM messages 
            ORDER BY created_at {sort}
            LIMIT ? OFFSET ?
        ''', (limit + 1, offset))
        
        rows = cursor.fetchall()
        
        # Check if there are more messages
        has_more = len(rows) > limit
        messages_list = []
        
        for i, row in enumerate(rows):
            if i < limit:  # Only include up to limit messages
                messages_list.append({
                    'username': row['username'],
                    'content': row['content'],
                    'created_at': row['created_at']
                })
        
        conn.close()
        
        # Render HTML template
        return render_template_string(HTML_TEMPLATE, 
                                     messages=messages_list,
                                     limit=limit,
                                     offset=offset,
                                     sort=sort.lower(),
                                     has_more=has_more)
    
    elif request.method == 'POST':
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        username = data.get('username')
        content = data.get('content')
        
        # Validate input
        if not username or not content:
            return jsonify({'error': 'Username and content are required'}), 400
        
        if not isinstance(username, str) or not isinstance(content, str):
            return jsonify({'error': 'Username and content must be strings'}), 400
        
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
            return jsonify({'message': 'Message posted successfully'}), 200
        except Exception as e:
            conn.close()
            return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)