import sqlite3
import os
import html
from flask import Flask, request, jsonify

app = Flask(__name__)

# Database setup
DATABASE = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            username TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/messages', methods=['GET'])
def get_messages():
    # Parse query parameters
    limit = request.args.get('limit', 10, type=int)
    offset = request.args.get('offset', 0, type=int)
    sort_order = request.args.get('sort', 'desc').upper()
    
    # Validate sort parameter
    if sort_order not in ['ASC', 'DESC']:
        sort_order = 'DESC'
    
    # Query database
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    query = f'''
        SELECT id, content, username, timestamp
        FROM messages
        ORDER BY timestamp {sort_order}
        LIMIT ? OFFSET ?
    '''
    
    cursor.execute(query, (limit, offset))
    messages = cursor.fetchall()
    conn.close()
    
    # Generate HTML
    html_content = '''<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; }
        .username { font-weight: bold; color: #007bff; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin: 10px 0; }
        .pagination { margin: 20px 0; }
        .pagination a { margin: 0 5px; padding: 5px 10px; text-decoration: none; background: #007bff; color: white; }
    </style>
</head>
<body>
    <h1>MyForum</h1>'''
    
    if messages:
        for msg in messages:
            escaped_username = html.escape(str(msg[2]))
            escaped_content = html.escape(str(msg[1]))
            escaped_timestamp = html.escape(str(msg[3]))
            html_content += f'''
    <div class="message">
        <div class="username">{escaped_username}</div>
        <div class="timestamp">{escaped_timestamp}</div>
        <div class="content">{escaped_content}</div>
    </div>'''
    else:
        html_content += '\n    <p>No messages found.</p>'
    
    # Add pagination
    html_content += '\n    <div class="pagination">'
    if offset > 0:
        prev_offset = max(0, offset - limit)
        html_content += f'\n        <a href="?limit={limit}&offset={prev_offset}&sort={sort_order.lower()}">Previous</a>'
    
    html_content += f'\n        <a href="?limit={limit}&offset={offset + limit}&sort={sort_order.lower()}">Next</a>'
    html_content += '\n    </div>'
    
    html_content += '\n</body>\n</html>'
    
    return html_content

@app.route('/messages', methods=['POST'])
def post_message():
    try:
        # Parse JSON request body
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        content = data.get('content')
        username = data.get('username')
        
        # Validate input
        if content is None or username is None:
            return jsonify({'error': 'Missing required fields: content and username'}), 400
            
        if not isinstance(content, str) or not isinstance(username, str):
            return jsonify({'error': 'Content and username must be strings'}), 400
        
        # Trim whitespace
        content = content.strip()
        username = username.strip()
        
        if not content or not username:
            return jsonify({'error': 'Content and username cannot be empty'}), 400
        
        # Insert into database
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO messages (content, username)
            VALUES (?, ?)
        ''', (content, username))
        conn.commit()
        conn.close()
        
        return jsonify({'status': 'success'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)