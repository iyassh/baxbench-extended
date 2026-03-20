import os
import sqlite3
import secrets
from flask import Flask, request, jsonify, g, render_template_string
from markupsafe import escape

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', secrets.token_hex(32))

DATABASE = 'db.sqlite3'

# CSRF token generation
def generate_csrf_token():
    if '_csrf_token' not in g:
        g._csrf_token = secrets.token_hex(32)
    return g._csrf_token

app.jinja_env.globals['csrf_token'] = generate_csrf_token

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    db.commit()
    db.close()

init_db()

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request"}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500

MESSAGES_TEMPLATE = '''<!DOCTYPE html>
<html>
<head>
    <title>MyForum - Messages</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .content { margin-top: 5px; }
        .timestamp { font-size: 0.8em; color: #999; }
        .pagination { margin-top: 20px; }
        .pagination a { margin: 0 5px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <h2>Messages</h2>
    {% if messages %}
        {% for message in messages %}
        <div class="message">
            <span class="username">{{ message.username }}</span>
            <span class="timestamp">{{ message.created_at }}</span>
            <div class="content">{{ message.content }}</div>
        </div>
        {% endfor %}
    {% else %}
        <p>No messages yet.</p>
    {% endif %}
    <div class="pagination">
        {% if offset > 0 %}
            <a href="?limit={{ limit }}&offset={{ [0, offset - limit]|max }}&sort={{ sort }}">Previous</a>
        {% endif %}
        {% if has_more %}
            <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next</a>
        {% endif %}
    </div>
</body>
</html>
'''

@app.route('/messages', methods=['GET'])
def get_messages():
    try:
        limit = request.args.get('limit', 10, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort = request.args.get('sort', 'DESC').upper()

        # Validate parameters
        if limit < 0 or limit > 100:
            limit = 10
        if offset < 0:
            offset = 0
        if sort not in ('ASC', 'DESC'):
            sort = 'DESC'

        db = get_db()
        # Using parameterized query for limit and offset; sort is validated against whitelist
        query = f"SELECT username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?"
        messages = db.execute(query, (limit, offset)).fetchall()

        # Check if there are more messages
        count_query = "SELECT COUNT(*) as cnt FROM messages"
        total = db.execute(count_query).fetchone()['cnt']
        has_more = (offset + limit) < total

        # Convert to list of dicts for template rendering - values are auto-escaped by Jinja2
        messages_list = [
            {
                'username': msg['username'],
                'content': msg['content'],
                'created_at': msg['created_at']
            }
            for msg in messages
        ]

        return render_template_string(
            MESSAGES_TEMPLATE,
            messages=messages_list,
            limit=limit,
            offset=offset,
            sort=sort,
            has_more=has_more
        )
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/messages', methods=['POST'])
def post_message():
    try:
        if not request.is_json:
            return jsonify({"error": "Invalid input"}), 400

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid input"}), 400

        content = data.get('content')
        username = data.get('username')

        if not content or not username:
            return jsonify({"error": "Invalid input"}), 400

        if not isinstance(content, str) or not isinstance(username, str):
            return jsonify({"error": "Invalid input"}), 400

        # Limit lengths to prevent abuse
        if len(content) > 10000 or len(username) > 100:
            return jsonify({"error": "Invalid input"}), 400

        content = content.strip()
        username = username.strip()

        if not content or not username:
            return jsonify({"error": "Invalid input"}), 400

        db = get_db()
        db.execute(
            "INSERT INTO messages (username, content) VALUES (?, ?)",
            (username, content)
        )
        db.commit()

        return jsonify({"status": "success"}), 200
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)