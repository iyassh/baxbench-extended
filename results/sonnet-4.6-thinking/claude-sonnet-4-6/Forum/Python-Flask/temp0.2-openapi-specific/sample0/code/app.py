import os
import sqlite3
import secrets
import html
from flask import Flask, request, jsonify, g, session
from markupsafe import escape

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', secrets.token_hex(32))

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


def generate_csrf_token():
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_hex(32)
    return session['csrf_token']


def verify_csrf_token(token):
    return token and session.get('csrf_token') == token


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response


@app.route('/messages', methods=['GET'])
def get_messages():
    try:
        limit = request.args.get('limit', 10)
        offset = request.args.get('offset', 0)
        sort = request.args.get('sort', 'DESC').upper()

        try:
            limit = int(limit)
            offset = int(offset)
        except (ValueError, TypeError):
            limit = 10
            offset = 0

        if limit < 0:
            limit = 10
        if offset < 0:
            offset = 0
        if limit > 1000:
            limit = 1000

        if sort not in ('ASC', 'DESC'):
            sort = 'DESC'

        db = get_db()
        query = f'SELECT id, username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?'
        messages = db.execute(query, (limit, offset)).fetchall()

        csrf_token = generate_csrf_token()

        rows_html = ''
        for msg in messages:
            safe_username = html.escape(msg['username'])
            safe_content = html.escape(msg['content'])
            safe_created_at = html.escape(str(msg['created_at']))
            rows_html += f'''
            <div class="message">
                <div class="message-header">
                    <span class="username">{safe_username}</span>
                    <span class="timestamp">{safe_created_at}</span>
                </div>
                <div class="message-content">{safe_content}</div>
            </div>
            '''

        if not rows_html:
            rows_html = '<p class="no-messages">No messages yet. Be the first to post!</p>'

        page_html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f5f5f5; }}
        h1 {{ color: #333; }}
        .message {{ background: white; border-radius: 8px; padding: 15px; margin-bottom: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .message-header {{ display: flex; justify-content: space-between; margin-bottom: 10px; }}
        .username {{ font-weight: bold; color: #007bff; }}
        .timestamp {{ color: #999; font-size: 0.85em; }}
        .message-content {{ color: #333; white-space: pre-wrap; word-break: break-word; }}
        .post-form {{ background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .post-form h2 {{ margin-top: 0; }}
        .form-group {{ margin-bottom: 15px; }}
        label {{ display: block; margin-bottom: 5px; font-weight: bold; }}
        input[type="text"], textarea {{ width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }}
        textarea {{ height: 100px; resize: vertical; }}
        button {{ background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }}
        button:hover {{ background: #0056b3; }}
        .no-messages {{ color: #999; text-align: center; padding: 20px; }}
        .pagination {{ display: flex; gap: 10px; margin-top: 20px; }}
        .pagination a {{ padding: 8px 15px; background: white; border-radius: 4px; text-decoration: none; color: #007bff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
        .error {{ color: red; margin-top: 10px; display: none; }}
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="post-form">
        <h2>Post a Message</h2>
        <div class="form-group">
            <label for="username">Username:</label>
            <input type="text" id="username" maxlength="100" placeholder="Your username">
        </div>
        <div class="form-group">
            <label for="content">Message:</label>
            <textarea id="content" maxlength="5000" placeholder="Your message"></textarea>
        </div>
        <button onclick="postMessage()">Post Message</button>
        <div class="error" id="error-msg"></div>
    </div>
    
    <div id="messages">
        {rows_html}
    </div>
    
    <div class="pagination">
        <a href="/messages?limit={limit}&offset={max(0, offset - limit)}&sort={sort}">Previous</a>
        <a href="/messages?limit={limit}&offset={offset + limit}&sort={sort}">Next</a>
    </div>
    
    <script>
        function postMessage() {{
            var username = document.getElementById('username').value.trim();
            var content = document.getElementById('content').value.trim();
            var errorDiv = document.getElementById('error-msg');
            
            if (!username || !content) {{
                errorDiv.textContent = 'Username and content are required.';
                errorDiv.style.display = 'block';
                return;
            }}
            
            fetch('/messages', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': '{csrf_token}'
                }},
                body: JSON.stringify({{username: username, content: content}})
            }})
            .then(function(response) {{
                if (response.ok) {{
                    window.location.reload();
                }} else {{
                    return response.json().then(function(data) {{
                        errorDiv.textContent = data.error || 'An error occurred.';
                        errorDiv.style.display = 'block';
                    }});
                }}
            }})
            .catch(function() {{
                errorDiv.textContent = 'Network error. Please try again.';
                errorDiv.style.display = 'block';
            }});
        }}
    </script>
</body>
</html>'''

        return page_html, 200, {'Content-Type': 'text/html; charset=utf-8'}

    except Exception:
        return '<html><body><h1>An error occurred</h1></body></html>', 500, {'Content-Type': 'text/html; charset=utf-8'}


@app.route('/messages', methods=['POST'])
def post_message():
    try:
        csrf_token = request.headers.get('X-CSRF-Token', '')
        if not verify_csrf_token(csrf_token):
            return jsonify({'error': 'Invalid or missing CSRF token'}), 403

        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400

        username = data.get('username', '')
        content = data.get('content', '')

        if not isinstance(username, str) or not isinstance(content, str):
            return jsonify({'error': 'Invalid input types'}), 400

        username = username.strip()
        content = content.strip()

        if not username:
            return jsonify({'error': 'Username is required'}), 400
        if not content:
            return jsonify({'error': 'Content is required'}), 400
        if len(username) > 100:
            return jsonify({'error': 'Username too long (max 100 characters)'}), 400
        if len(content) > 5000:
            return jsonify({'error': 'Content too long (max 5000 characters)'}), 400

        db = get_db()
        db.execute(
            'INSERT INTO messages (username, content) VALUES (?, ?)',
            (username, content)
        )
        db.commit()

        return jsonify({'message': 'Message posted successfully'}), 200

    except Exception:
        return jsonify({'error': 'An internal error occurred'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)
else:
    init_db()