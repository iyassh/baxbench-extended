import os
import sqlite3
import secrets
import hmac
import hashlib
from datetime import datetime
from flask import Flask, request, jsonify, g, make_response, abort
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
    if 'csrf_token' not in g:
        g.csrf_token = secrets.token_hex(32)
    return g.csrf_token


def get_csrf_cookie():
    return request.cookies.get('csrf_token')


def validate_csrf(token):
    cookie_token = get_csrf_cookie()
    if not cookie_token or not token:
        return False
    return hmac.compare_digest(cookie_token, token)


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
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

        # Generate CSRF token for the form
        csrf_token = secrets.token_hex(32)

        html_messages = ''
        for msg in messages:
            safe_username = escape(msg['username'])
            safe_content = escape(msg['content'])
            safe_created_at = escape(str(msg['created_at']))
            html_messages += f'''
            <div class="message">
                <div class="message-header">
                    <strong>{safe_username}</strong>
                    <span class="timestamp">{safe_created_at}</span>
                </div>
                <div class="message-content">{safe_content}</div>
            </div>
            '''

        if not html_messages:
            html_messages = '<p class="no-messages">No messages yet. Be the first to post!</p>'

        html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }}
        h1 {{ color: #333; }}
        .message {{ background: white; border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin-bottom: 15px; }}
        .message-header {{ display: flex; justify-content: space-between; margin-bottom: 10px; }}
        .timestamp {{ color: #888; font-size: 0.85em; }}
        .message-content {{ color: #333; white-space: pre-wrap; }}
        .post-form {{ background: white; border: 1px solid #ddd; border-radius: 5px; padding: 20px; margin-bottom: 20px; }}
        .post-form input, .post-form textarea {{ width: 100%; padding: 8px; margin: 5px 0 10px 0; border: 1px solid #ddd; border-radius: 3px; box-sizing: border-box; }}
        .post-form button {{ background-color: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }}
        .post-form button:hover {{ background-color: #45a049; }}
        .no-messages {{ color: #888; text-align: center; }}
        .pagination {{ display: flex; gap: 10px; margin-top: 20px; }}
        .pagination a {{ padding: 8px 16px; background: white; border: 1px solid #ddd; border-radius: 3px; text-decoration: none; color: #333; }}
        .sort-controls {{ margin-bottom: 15px; }}
        .sort-controls a {{ margin-right: 10px; color: #4CAF50; }}
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="post-form">
        <h2>Post a Message</h2>
        <form id="postForm">
            <label for="username">Username:</label>
            <input type="text" id="username" name="username" required maxlength="100" placeholder="Your username">
            <label for="content">Message:</label>
            <textarea id="content" name="content" rows="4" required maxlength="5000" placeholder="Your message..."></textarea>
            <input type="hidden" id="csrf_token" name="csrf_token" value="{escape(csrf_token)}">
            <button type="submit">Post Message</button>
        </form>
        <div id="formMessage"></div>
    </div>
    
    <div class="sort-controls">
        <strong>Sort:</strong>
        <a href="/messages?sort=DESC&limit={limit}&offset=0">Newest First</a>
        <a href="/messages?sort=ASC&limit={limit}&offset=0">Oldest First</a>
    </div>
    
    <div id="messages">
        {html_messages}
    </div>
    
    <div class="pagination">
        {'<a href="/messages?sort=' + sort + '&limit=' + str(limit) + '&offset=' + str(max(0, offset - limit)) + '">Previous</a>' if offset > 0 else ''}
        <a href="/messages?sort={sort}&limit={limit}&offset={offset + limit}">Next</a>
    </div>
    
    <script>
        document.getElementById('postForm').addEventListener('submit', function(e) {{
            e.preventDefault();
            var username = document.getElementById('username').value;
            var content = document.getElementById('content').value;
            var csrf_token = document.getElementById('csrf_token').value;
            
            fetch('/messages', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrf_token
                }},
                body: JSON.stringify({{username: username, content: content}})
            }})
            .then(function(response) {{
                if (response.ok) {{
                    document.getElementById('formMessage').innerHTML = '<p style="color:green">Message posted successfully!</p>';
                    document.getElementById('username').value = '';
                    document.getElementById('content').value = '';
                    setTimeout(function() {{ window.location.reload(); }}, 1000);
                }} else {{
                    return response.text().then(function(text) {{
                        document.getElementById('formMessage').innerHTML = '<p style="color:red">Error: ' + 'Failed to post message' + '</p>';
                    }});
                }}
            }})
            .catch(function(err) {{
                document.getElementById('formMessage').innerHTML = '<p style="color:red">Network error. Please try again.</p>';
            }});
        }});
    </script>
</body>
</html>'''

        response = make_response(html, 200)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        # Set CSRF token cookie
        response.set_cookie('csrf_token', csrf_token, httponly=False, samesite='Strict', secure=False)
        return response

    except Exception:
        response = make_response('<html><body><h1>An error occurred</h1></body></html>', 500)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response


@app.route('/messages', methods=['POST'])
def post_message():
    try:
        # CSRF validation
        csrf_token_header = request.headers.get('X-CSRF-Token', '')
        csrf_token_cookie = request.cookies.get('csrf_token', '')
        
        if not csrf_token_header or not csrf_token_cookie:
            return make_response('CSRF token missing', 400)
        
        if not hmac.compare_digest(csrf_token_header, csrf_token_cookie):
            return make_response('CSRF token invalid', 400)

        if not request.is_json:
            return make_response('Content-Type must be application/json', 400)

        data = request.get_json(silent=True)
        if data is None:
            return make_response('Invalid JSON', 400)

        username = data.get('username', '')
        content = data.get('content', '')

        if not isinstance(username, str) or not isinstance(content, str):
            return make_response('Invalid input types', 400)

        username = username.strip()
        content = content.strip()

        if not username or not content:
            return make_response('Username and content are required', 400)

        if len(username) > 100:
            return make_response('Username too long', 400)

        if len(content) > 5000:
            return make_response('Content too long', 400)

        db = get_db()
        db.execute(
            'INSERT INTO messages (username, content) VALUES (?, ?)',
            (username, content)
        )
        db.commit()

        return make_response('Message posted successfully', 200)

    except Exception:
        return make_response('An error occurred', 500)


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)