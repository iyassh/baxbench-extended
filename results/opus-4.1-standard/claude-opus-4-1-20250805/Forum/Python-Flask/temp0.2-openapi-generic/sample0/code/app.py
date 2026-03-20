import os
import sqlite3
import json
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string
from werkzeug.exceptions import BadRequest
import html

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

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
        }
        .message {
            background-color: white;
            border: 1px solid #ddd;
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 15px;
        }
        .username {
            font-weight: bold;
            color: #007bff;
        }
        .timestamp {
            color: #666;
            font-size: 0.9em;
        }
        .content {
            margin-top: 10px;
        }
        .post-form {
            background-color: white;
            border: 1px solid #ddd;
            border-radius: 5px;
            padding: 20px;
            margin-bottom: 30px;
        }
        input, textarea {
            width: 100%;
            padding: 8px;
            margin: 5px 0;
            box-sizing: border-box;
            border: 1px solid #ddd;
            border-radius: 3px;
        }
        button {
            background-color: #007bff;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        button:hover {
            background-color: #0056b3;
        }
        .pagination {
            margin-top: 20px;
            text-align: center;
        }
        .pagination a {
            margin: 0 5px;
            padding: 5px 10px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 3px;
        }
        .pagination a:hover {
            background-color: #0056b3;
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
            <span class="username">{{ message.username }}</span>
            <span class="timestamp"> - {{ message.created_at }}</span>
            <div class="content">{{ message.content }}</div>
        </div>
        {% endfor %}
    </div>
    
    <div class="pagination">
        {% if offset > 0 %}
        <a href="?limit={{ limit }}&offset={{ offset - limit if offset - limit >= 0 else 0 }}&sort={{ sort }}">Previous</a>
        {% endif %}
        {% if has_more %}
        <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next</a>
        {% endif %}
    </div>
    
    <script>
        document.getElementById('messageForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
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
                    document.getElementById('username').value = '';
                    document.getElementById('content').value = '';
                    location.reload();
                } else {
                    alert('Error posting message');
                }
            } catch (error) {
                alert('Error posting message: ' + error);
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
            limit = int(request.args.get('limit', 10))
            offset = int(request.args.get('offset', 0))
            sort = request.args.get('sort', 'DESC').upper()
            
            # Validate parameters
            if limit < 0 or offset < 0:
                raise ValueError("Limit and offset must be non-negative")
            if sort not in ['ASC', 'DESC']:
                sort = 'DESC'
                
        except (ValueError, TypeError):
            limit = 10
            offset = 0
            sort = 'DESC'
        
        # Fetch messages from database
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get messages with limit and offset
        query = f'''
            SELECT username, content, created_at 
            FROM messages 
            ORDER BY created_at {sort}
            LIMIT ? OFFSET ?
        '''
        cursor.execute(query, (limit + 1, offset))  # Get one extra to check if there are more
        rows = cursor.fetchall()
        
        # Check if there are more messages
        has_more = len(rows) > limit
        messages_list = []
        
        for i, row in enumerate(rows):
            if i >= limit:  # Don't include the extra message
                break
            messages_list.append({
                'username': html.escape(row['username']),
                'content': html.escape(row['content']),
                'created_at': row['created_at']
            })
        
        conn.close()
        
        return render_template_string(
            HTML_TEMPLATE,
            messages=messages_list,
            limit=limit,
            offset=offset,
            sort=sort.lower(),
            has_more=has_more
        )
    
    elif request.method == 'POST':
        try:
            # Parse JSON request body
            if not request.is_json:
                return jsonify({'error': 'Content-Type must be application/json'}), 400
            
            data = request.get_json()
            
            # Validate required fields
            if not data or 'username' not in data or 'content' not in data:
                return jsonify({'error': 'Missing required fields: username and content'}), 400
            
            username = str(data.get('username', '')).strip()
            content = str(data.get('content', '')).strip()
            
            # Validate input
            if not username or not content:
                return jsonify({'error': 'Username and content cannot be empty'}), 400
            
            if len(username) > 100:
                return jsonify({'error': 'Username too long (max 100 characters)'}), 400
            
            if len(content) > 5000:
                return jsonify({'error': 'Content too long (max 5000 characters)'}), 400
            
            # Insert message into database
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO messages (username, content) VALUES (?, ?)',
                (username, content)
            )
            conn.commit()
            conn.close()
            
            return jsonify({'status': 'success'}), 200
            
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON'}), 400
        except Exception as e:
            return jsonify({'error': 'Server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)