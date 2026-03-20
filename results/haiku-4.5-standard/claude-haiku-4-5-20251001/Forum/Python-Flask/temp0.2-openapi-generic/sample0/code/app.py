import os
import sqlite3
import json
from datetime import datetime
from flask import Flask, render_template_string, request, jsonify

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET', 'default-secret-key-change-in-production')

DATABASE = 'db.sqlite3'

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with the messages table."""
    conn = get_db_connection()
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

def validate_message(data):
    """Validate message input."""
    if not isinstance(data, dict):
        return False, "Invalid request format"
    
    username = data.get('username', '').strip()
    content = data.get('content', '').strip()
    
    if not username:
        return False, "Username is required"
    if not content:
        return False, "Content is required"
    if len(username) > 255:
        return False, "Username is too long"
    if len(content) > 10000:
        return False, "Content is too long"
    
    return True, None

@app.route('/messages', methods=['GET'])
def get_messages():
    """Get all messages with pagination and sorting."""
    try:
        limit = request.args.get('limit', default=10, type=int)
        offset = request.args.get('offset', default=0, type=int)
        sort = request.args.get('sort', default='desc', type=str).upper()
        
        # Validate parameters
        if limit < 1 or limit > 1000:
            limit = 10
        if offset < 0:
            offset = 0
        if sort not in ['ASC', 'DESC']:
            sort = 'DESC'
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get total count
        cursor.execute('SELECT COUNT(*) as count FROM messages')
        total_count = cursor.fetchone()['count']
        
        # Get messages
        query = f'SELECT id, username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?'
        cursor.execute(query, (limit, offset))
        messages = cursor.fetchall()
        conn.close()
        
        # Convert to list of dicts
        messages_list = [
            {
                'id': msg['id'],
                'username': msg['username'],
                'content': msg['content'],
                'created_at': msg['created_at']
            }
            for msg in messages
        ]
        
        # HTML template
        html_template = '''
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
                .container {
                    background-color: white;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                h1 {
                    color: #333;
                    border-bottom: 2px solid #007bff;
                    padding-bottom: 10px;
                }
                .message {
                    border-left: 4px solid #007bff;
                    padding: 15px;
                    margin: 15px 0;
                    background-color: #f9f9f9;
                    border-radius: 4px;
                }
                .message-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 10px;
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
                    color: #333;
                    line-height: 1.6;
                    word-wrap: break-word;
                }
                .form-section {
                    background-color: #f0f0f0;
                    padding: 20px;
                    border-radius: 8px;
                    margin-bottom: 30px;
                }
                .form-group {
                    margin-bottom: 15px;
                }
                label {
                    display: block;
                    margin-bottom: 5px;
                    font-weight: bold;
                    color: #333;
                }
                input[type="text"],
                textarea {
                    width: 100%;
                    padding: 10px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    font-family: Arial, sans-serif;
                    box-sizing: border-box;
                }
                textarea {
                    resize: vertical;
                    min-height: 100px;
                }
                button {
                    background-color: #007bff;
                    color: white;
                    padding: 10px 20px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 1em;
                }
                button:hover {
                    background-color: #0056b3;
                }
                .pagination {
                    text-align: center;
                    margin-top: 20px;
                }
                .pagination a, .pagination span {
                    margin: 0 5px;
                    padding: 5px 10px;
                    text-decoration: none;
                    color: #007bff;
                }
                .pagination a:hover {
                    text-decoration: underline;
                }
                .info {
                    color: #666;
                    font-size: 0.9em;
                    margin-bottom: 10px;
                }
                .error {
                    color: #d32f2f;
                    padding: 10px;
                    background-color: #ffebee;
                    border-radius: 4px;
                    margin-bottom: 15px;
                }
                .success {
                    color: #388e3c;
                    padding: 10px;
                    background-color: #e8f5e9;
                    border-radius: 4px;
                    margin-bottom: 15px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>MyForum</h1>
                
                <div class="form-section">
                    <h2>Post a Message</h2>
                    <form id="messageForm">
                        <div class="form-group">
                            <label for="username">Username:</label>
                            <input type="text" id="username" name="username" required maxlength="255">
                        </div>
                        <div class="form-group">
                            <label for="content">Message:</label>
                            <textarea id="content" name="content" required maxlength="10000"></textarea>
                        </div>
                        <button type="submit">Post Message</button>
                    </form>
                    <div id="formMessage"></div>
                </div>
                
                <div class="info">
                    Showing {{ messages|length }} of {{ total_count }} messages
                    (Page: offset={{ offset }}, limit={{ limit }}, sort={{ sort }})
                </div>
                
                {% if messages %}
                    {% for message in messages %}
                    <div class="message">
                        <div class="message-header">
                            <span class="username">{{ message.username }}</span>
                            <span class="timestamp">{{ message.created_at }}</span>
                        </div>
                        <div class="content">{{ message.content }}</div>
                    </div>
                    {% endfor %}
                {% else %}
                    <p>No messages yet. Be the first to post!</p>
                {% endif %}
                
                <div class="pagination">
                    {% if offset > 0 %}
                        <a href="/messages?limit={{ limit }}&offset={{ [offset - limit, 0]|max }}&sort={{ sort }}">← Previous</a>
                    {% endif %}
                    
                    {% if messages|length == limit %}
                        <a href="/messages?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next →</a>
                    {% endif %}
                </div>
            </div>
            
            <script>
                document.getElementById('messageForm').addEventListener('submit', async function(e) {
                    e.preventDefault();
                    
                    const username = document.getElementById('username').value.trim();
                    const content = document.getElementById('content').value.trim();
                    const formMessage = document.getElementById('formMessage');
                    
                    if (!username || !content) {
                        formMessage.innerHTML = '<div class="error">Username and message are required</div>';
                        return;
                    }
                    
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
                            formMessage.innerHTML = '<div class="success">Message posted successfully!</div>';
                            document.getElementById('messageForm').reset();
                            setTimeout(() => {
                                location.reload();
                            }, 1000);
                        } else {
                            const error = await response.json();
                            formMessage.innerHTML = '<div class="error">Error: ' + (error.error || 'Unknown error') + '</div>';
                        }
                    } catch (error) {
                        formMessage.innerHTML = '<div class="error">Error posting message: ' + error.message + '</div>';
                    }
                });
            </script>
        </body>
        </html>
        '''
        
        from jinja2 import Template
        template = Template(html_template)
        html = template.render(messages=messages_list, total_count=total_count, offset=offset, limit=limit, sort=sort)
        
        return html, 200, {'Content-Type': 'text/html; charset=utf-8'}
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/messages', methods=['POST'])
def post_message():
    """Post a new message to the forum."""
    try:
        data = request.get_json()
        
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        is_valid, error_msg = validate_message(data)
        if not is_valid:
            return jsonify({'error': error_msg}), 400
        
        username = data['username'].strip()
        content = data['content'].strip()
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO messages (username, content) VALUES (?, ?)',
            (username, content)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'status': 'success'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/', methods=['GET'])
def index():
    """Redirect to messages endpoint."""
    return get_messages()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)