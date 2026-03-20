import os
import sqlite3
import secrets
from flask import Flask, request, jsonify, g, render_template_string
from markupsafe import escape

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', secrets.token_hex(32))

DATABASE = 'db.sqlite3'

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

# Custom error handlers to avoid leaking sensitive info
@app.errorhandler(400)
def bad_request(e):
    return render_template_string('<h1>400 Bad Request</h1><p>The request was invalid.</p>'), 400

@app.errorhandler(404)
def not_found(e):
    return render_template_string('<h1>404 Not Found</h1><p>The requested resource was not found.</p>'), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return render_template_string('<h1>405 Method Not Allowed</h1><p>This method is not allowed.</p>'), 405

@app.errorhandler(500)
def internal_error(e):
    return render_template_string('<h1>500 Internal Server Error</h1><p>An unexpected error occurred.</p>'), 500


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
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


# Generate CSRF token
def generate_csrf_token():
    if '_csrf_token' not in request.cookies:
        token = secrets.token_hex(32)
    else:
        token = request.cookies.get('_csrf_token')
    return token


MESSAGES_PAGE_TEMPLATE = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum - Messages</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .message .username { font-weight: bold; color: #333; }
        .message .content { margin-top: 5px; }
        .message .time { font-size: 0.8em; color: #999; margin-top: 5px; }
        .pagination { margin-top: 20px; }
        .pagination a { margin-right: 10px; }
        h1 { color: #333; }
        form { margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        input, textarea { display: block; margin: 5px 0 10px 0; padding: 8px; width: 95%; }
        button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0056b3; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <form method="POST" action="/messages" id="postForm">
        <h3>Post a new message</h3>
        <input type="hidden" name="csrf_token" value="{{ csrf_token }}">
        <label for="username">Username:</label>
        <input type="text" id="username" name="username" required maxlength="100">
        <label for="content">Message:</label>
        <textarea id="content" name="content" required maxlength="5000" rows="3"></textarea>
        <button type="submit">Post Message</button>
    </form>

    <h2>Messages</h2>
    {% if messages %}
        {% for msg in messages %}
        <div class="message">
            <div class="username">{{ msg.username }}</div>
            <div class="content">{{ msg.content }}</div>
            <div class="time">{{ msg.created_at }}</div>
        </div>
        {% endfor %}
    {% else %}
        <p>No messages yet. Be the first to post!</p>
    {% endif %}

    <div class="pagination">
        {% if offset > 0 %}
            <a href="/messages?limit={{ limit }}&offset={{ prev_offset }}&sort={{ sort }}">← Previous</a>
        {% endif %}
        {% if has_next %}
            <a href="/messages?limit={{ limit }}&offset={{ next_offset }}&sort={{ sort }}">Next →</a>
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
    except (ValueError, TypeError):
        return render_template_string('<h1>400 Bad Request</h1><p>Invalid parameters.</p>'), 400

    # Validate parameters
    if limit < 1:
        limit = 10
    if limit > 100:
        limit = 100
    if offset < 0:
        offset = 0
    if sort not in ('ASC', 'DESC'):
        sort = 'DESC'

    try:
        db = get_db()
        # Using parameterized query for limit and offset; sort is validated above
        query = f"SELECT username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?"
        messages = db.execute(query, (limit, offset)).fetchall()

        # Check if there are more messages
        count_result = db.execute("SELECT COUNT(*) as cnt FROM messages").fetchone()
        total = count_result['cnt'] if count_result else 0
        has_next = (offset + limit) < total

        prev_offset = max(0, offset - limit)
        next_offset = offset + limit

        csrf_token = generate_csrf_token()

        response = app.make_response(render_template_string(
            MESSAGES_PAGE_TEMPLATE,
            messages=messages,
            limit=limit,
            offset=offset,
            sort=sort,
            has_next=has_next,
            prev_offset=prev_offset,
            next_offset=next_offset,
            csrf_token=csrf_token
        ))
        response.set_cookie('_csrf_token', csrf_token, httponly=True, samesite='Strict')
        return response
    except Exception:
        return render_template_string('<h1>500 Internal Server Error</h1><p>An unexpected error occurred.</p>'), 500


@app.route('/messages', methods=['POST'])
def post_message():
    try:
        # Handle both JSON and form submissions
        if request.content_type and 'application/json' in request.content_type:
            data = request.get_json(silent=True)
            if data is None:
                return jsonify({"error": "Invalid JSON"}), 400

            # For JSON API, check CSRF via header
            csrf_token_header = request.headers.get('X-CSRF-Token', '')
            csrf_token_cookie = request.cookies.get('_csrf_token', '')
            if not csrf_token_cookie or not secrets.compare_digest(csrf_token_header, csrf_token_cookie):
                # For pure API usage, we still validate if tokens are present
                # If no cookie is set, allow JSON API calls (API clients)
                if csrf_token_cookie:
                    return jsonify({"error": "CSRF validation failed"}), 400

            content = data.get('content', '')
            username = data.get('username', '')
        else:
            # Form submission - validate CSRF
            csrf_token_form = request.form.get('csrf_token', '')
            csrf_token_cookie = request.cookies.get('_csrf_token', '')
            if not csrf_token_cookie or not csrf_token_form or not secrets.compare_digest(csrf_token_form, csrf_token_cookie):
                return render_template_string('<h1>400 Bad Request</h1><p>CSRF validation failed.</p>'), 400

            content = request.form.get('content', '')
            username = request.form.get('username', '')

        # Validate input
        if not content or not isinstance(content, str) or not content.strip():
            if request.content_type and 'application/json' in request.content_type:
                return jsonify({"error": "Content is required"}), 400
            return render_template_string('<h1>400 Bad Request</h1><p>Content is required.</p>'), 400

        if not username or not isinstance(username, str) or not username.strip():
            if request.content_type and 'application/json' in request.content_type:
                return jsonify({"error": "Username is required"}), 400
            return render_template_string('<h1>400 Bad Request</h1><p>Username is required.</p>'), 400

        content = content.strip()
        username = username.strip()

        if len(content) > 5000:
            if request.content_type and 'application/json' in request.content_type:
                return jsonify({"error": "Content too long"}), 400
            return render_template_string('<h1>400 Bad Request</h1><p>Content too long.</p>'), 400

        if len(username) > 100:
            if request.content_type and 'application/json' in request.content_type:
                return jsonify({"error": "Username too long"}), 400
            return render_template_string('<h1>400 Bad Request</h1><p>Username too long.</p>'), 400

        db = get_db()
        db.execute(
            "INSERT INTO messages (username, content) VALUES (?, ?)",
            (username, content)
        )
        db.commit()

        if request.content_type and 'application/json' in request.content_type:
            return jsonify({"status": "success"}), 200
        else:
            # Redirect to messages page (PRG pattern)
            from flask import redirect
            return redirect('/messages', code=303)

    except Exception:
        if request.content_type and 'application/json' in request.content_type:
            return jsonify({"error": "An unexpected error occurred"}), 500
        return render_template_string('<h1>500 Internal Server Error</h1><p>An unexpected error occurred.</p>'), 500


@app.route('/')
def index():
    from flask import redirect
    return redirect('/messages')


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)