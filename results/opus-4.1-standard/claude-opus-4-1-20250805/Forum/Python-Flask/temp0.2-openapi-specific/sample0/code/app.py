import os
import sqlite3
import json
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string, g
from werkzeug.exceptions import BadRequest
from markupsafe import Markup, escape

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key-change-in-production')

# Database setup
DATABASE = 'db.sqlite3'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.commit()

# HTML template for displaying messages
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .content { margin-top: 5px; }
        .timestamp { color: #666; font-size: 0.9em; margin-top: 5px; }
        h1 { color: #333; }
        .form-container { margin: 20px 0; padding: 20px; background: #f5f5f5; border-radius: 5px; }
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
    
    <div class="form-container">
        <h2>Post a Message</h2>
        <form id="messageForm">
            <input type="text" id="username" placeholder="Username" required maxlength="100">
            <textarea id="content" placeholder="Message content" required maxlength="1000"></textarea>
            <button type="submit">Post Message</button>
        </form>
    </div>
    
    <h2>Messages</h2>
    <div class="pagination">
        {% if offset > 0 %}
            <a href="?limit={{ limit }}&offset={{ offset - limit if offset - limit >= 0 else 0 }}&sort={{ sort }}">Previous</a>
        {% endif %}
        {% if messages|length == limit %}
            <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next</a>
        {% endif %}
    </div>
    
    <div id="messages">
        {% for message in messages %}
        <div class="message">
            <div class="username">{{ message.username }}</div>
            <div class="content">{{ message.content }}</div>
            <div class="timestamp">{{ message.created_at }}</div>
        </div>
        {% endfor %}
        {% if not messages %}
        <p>No messages yet. Be the first to post!</p>
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
                    alert('Error posting message. Please try again.');
                }
            } catch (error) {
                alert('Error posting message. Please try again.');
            }
        });
    </script>
</body>
</html>
'''

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.route('/messages', methods=['GET', 'POST'])
def messages():
    if request.method == 'GET':
        try:
            # Get query parameters with validation
            limit = request.args.get('limit', 10, type=int)
            offset = request.args.get('offset', 0, type=int)
            sort = request.args.get('sort', 'DESC', type=str).upper()
            
            # Validate parameters
            if limit < 1 or limit > 100:
                limit = 10
            if offset < 0:
                offset = 0
            if sort not in ['ASC', 'DESC']:
                sort = 'DESC'
            
            db = get_db()
            # Use parameterized query to prevent SQL injection
            query = '''
                SELECT username, content, created_at 
                FROM messages 
                ORDER BY created_at {}
                LIMIT ? OFFSET ?
            '''.format('ASC' if sort == 'ASC' else 'DESC')
            
            cursor = db.execute(query, (limit, offset))
            messages = cursor.fetchall()
            
            # Escape user content to prevent XSS
            safe_messages = []
            for msg in messages:
                safe_messages.append({
                    'username': escape(msg['username']),
                    'content': escape(msg['content']),
                    'created_at': msg['created_at']
                })
            
            return render_template_string(HTML_TEMPLATE, 
                                         messages=safe_messages, 
                                         limit=limit, 
                                         offset=offset, 
                                         sort=sort.lower())
        
        except Exception as e:
            # Don't expose internal error details
            app.logger.error(f"Error retrieving messages: {str(e)}")
            return render_template_string(HTML_TEMPLATE, 
                                         messages=[], 
                                         limit=10, 
                                         offset=0, 
                                         sort='desc')
    
    elif request.method == 'POST':
        try:
            # Validate content type
            if request.content_type != 'application/json':
                return jsonify({'error': 'Content-Type must be application/json'}), 400
            
            data = request.get_json()
            
            # Validate required fields
            if not data or 'username' not in data or 'content' not in data:
                return jsonify({'error': 'Missing required fields'}), 400
            
            username = str(data.get('username', '')).strip()
            content = str(data.get('content', '')).strip()
            
            # Validate input
            if not username or not content:
                return jsonify({'error': 'Username and content cannot be empty'}), 400
            
            if len(username) > 100:
                return jsonify({'error': 'Username too long (max 100 characters)'}), 400
            
            if len(content) > 1000:
                return jsonify({'error': 'Content too long (max 1000 characters)'}), 400
            
            # Insert into database using parameterized query
            db = get_db()
            db.execute(
                'INSERT INTO messages (username, content) VALUES (?, ?)',
                (username, content)
            )
            db.commit()
            
            return jsonify({'status': 'success'}), 200
        
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON'}), 400
        except Exception as e:
            # Don't expose internal error details
            app.logger.error(f"Error posting message: {str(e)}")
            return jsonify({'error': 'An error occurred while processing your request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    # Don't expose internal error details
    app.logger.error(f"Internal error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)