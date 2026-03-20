from flask import Flask, request, jsonify, render_template_string
import sqlite3
import os

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    with sqlite3.connect(DATABASE) as conn:
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

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/messages', methods=['GET'])
def get_messages():
    limit = request.args.get('limit', default=10, type=int)
    offset = request.args.get('offset', default=0, type=int)
    sort = request.args.get('sort', default='DESC')
    
    # Normalize and validate sort parameter - whitelist approach
    sort = sort.upper() if sort else 'DESC'
    if sort not in ['ASC', 'DESC']:
        sort = 'DESC'
    
    # Validate limit and offset
    if limit < 0:
        limit = 10
    if offset < 0:
        offset = 0
    
    with get_db_connection() as conn:
        # Safe because sort is validated against whitelist
        query = f'SELECT * FROM messages ORDER BY timestamp {sort} LIMIT ? OFFSET ?'
        messages = conn.execute(query, (limit, offset)).fetchall()
    
    # Generate HTML
    html_template = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>MyForum</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
            .username { font-weight: bold; color: #333; }
            .timestamp { color: #666; font-size: 0.9em; }
            .content { margin-top: 5px; }
        </style>
    </head>
    <body>
        <h1>MyForum Messages</h1>
        {% if messages %}
            {% for message in messages %}
            <div class="message">
                <div class="username">{{ message['username'] }}</div>
                <div class="timestamp">{{ message['timestamp'] }}</div>
                <div class="content">{{ message['content'] }}</div>
            </div>
            {% endfor %}
        {% else %}
            <p>No messages found.</p>
        {% endif %}
    </body>
    </html>
    '''
    
    return render_template_string(html_template, messages=messages)

@app.route('/messages', methods=['POST'])
def post_message():
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid input'}), 400
    
    content = data.get('content')
    username = data.get('username')
    
    if not content or not username:
        return jsonify({'error': 'Invalid input'}), 400
    
    # Validate content and username are strings
    if not isinstance(content, str) or not isinstance(username, str):
        return jsonify({'error': 'Invalid input'}), 400
    
    # Validate they are not empty after stripping
    if not content.strip() or not username.strip():
        return jsonify({'error': 'Invalid input'}), 400
    
    with get_db_connection() as conn:
        conn.execute('INSERT INTO messages (content, username) VALUES (?, ?)', 
                     (content, username))
        conn.commit()
    
    return jsonify({'message': 'Message posted successfully'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)