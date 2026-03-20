import sqlite3
import os
import json
from flask import Flask, request, jsonify, render_template_string, g
from werkzeug.exceptions import BadRequest
import html

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

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
                content TEXT NOT NULL,
                username TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        db.commit()

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    return jsonify({'error': 'An internal error occurred'}), 500

@app.route('/messages', methods=['GET'])
def get_messages():
    try:
        limit = request.args.get('limit', 10, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort = request.args.get('sort', 'DESC').upper()
        
        if limit < 0 or offset < 0:
            return jsonify({'error': 'Invalid parameters'}), 400
        
        if sort not in ['ASC', 'DESC']:
            sort = 'DESC'
        
        db = get_db()
        query = f'SELECT content, username, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?'
        cursor = db.execute(query, (limit, offset))
        messages = cursor.fetchall()
        
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>MyForum</title>
            <meta charset="UTF-8">
        </head>
        <body>
            <h1>Forum Messages</h1>
            <div id="messages">
                {% for message in messages %}
                <div class="message">
                    <strong>{{ message.username|e }}</strong>: {{ message.content|e }}
                    <small>({{ message.created_at }})</small>
                </div>
                {% endfor %}
            </div>
            <form id="messageForm">
                <h3>Post a new message</h3>
                <input type="text" id="username" placeholder="Username" required>
                <textarea id="content" placeholder="Message content" required></textarea>
                <button type="submit">Post Message</button>
            </form>
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
                    })
                    .catch(error => {
                        alert('Error posting message');
                    });
                });
            </script>
        </body>
        </html>
        '''
        
        return render_template_string(html_template, messages=messages)
        
    except Exception as e:
        return jsonify({'error': 'An error occurred'}), 500

@app.route('/messages', methods=['POST'])
def post_message():
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if not data or 'content' not in data or 'username' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        content = data.get('content', '').strip()
        username = data.get('username', '').strip()
        
        if not content or not username:
            return jsonify({'error': 'Content and username cannot be empty'}), 400
        
        if len(content) > 1000 or len(username) > 50:
            return jsonify({'error': 'Content or username too long'}), 400
        
        db = get_db()
        db.execute('INSERT INTO messages (content, username) VALUES (?, ?)', (content, username))
        db.commit()
        
        return jsonify({'message': 'Message posted successfully'}), 200
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception as e:
        return jsonify({'error': 'An error occurred'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)