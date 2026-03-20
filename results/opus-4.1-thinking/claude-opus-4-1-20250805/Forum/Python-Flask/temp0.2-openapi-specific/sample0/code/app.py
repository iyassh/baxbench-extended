import os
import sqlite3
import json
import secrets
from flask import Flask, request, render_template_string, jsonify, session, make_response
from markupsafe import escape

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', os.urandom(32).hex())

# Database initialization
def init_db():
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL CHECK(length(username) <= 100),
                content TEXT NOT NULL CHECK(length(content) <= 1000),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()
    except sqlite3.Error:
        pass  # Table exists
    finally:
        if conn:
            conn.close()

# Generate CSRF token
def generate_csrf_token():
    if '_csrf_token' not in session:
        session['_csrf_token'] = secrets.token_hex(32)
    return session['_csrf_token']

# Add security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

# HTML template
HTML_TEMPLATE = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f8f9fa; }
        h1 { color: #212529; border-bottom: 2px solid #0d6efd; padding-bottom: 10px; }
        .form-container { background: white; padding: 20px; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .message { background: white; border-left: 4px solid #0d6efd; padding: 15px; margin: 15px 0; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .username { font-weight: 600; color: #0d6efd; margin-bottom: 5px; }
        .content { color: #212529; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
        .timestamp { color: #6c757d; font-size: 0.85em; margin-top: 8px; }
        input, textarea { width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #ced4da; border-radius: 4px; font-family: inherit; font-size: 14px; }
        button { background: #0d6efd; color: white; padding: 10px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 15px; font-weight: 500; }
        button:hover { background: #0b5ed7; }
        button:active { transform: translateY(1px); }
        .pagination { margin: 20px 0; text-align: center; }
        .pagination a { margin: 0 5px; padding: 8px 16px; background: #0d6efd; color: white; text-decoration: none; border-radius: 4px; display: inline-block; }
        .pagination a:hover { background: #0b5ed7; }
        .status { padding: 10px; margin: 10px 0; border-radius: 4px; }
        .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .no-messages { text-align: center; color: #6c757d; padding: 40px; background: white; border-radius: 8px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="form-container">
        <h3>Post a New Message</h3>
        <div id="status-message"></div>
        <form id="message-form">
            <input type="text" id="username" placeholder="Enter your username" required maxlength="100">
            <textarea id="content" placeholder="Write your message here..." required maxlength="1000" rows="4"></textarea>
            <button type="submit">Post Message</button>
        </form>
    </div>
    
    <h2>Messages</h2>
    
    {% if messages %}
    <div class="pagination">
        {% if offset > 0 %}
        <a href="/messages?limit={{ limit }}&offset={{ [0, offset - limit]|max }}&sort={{ sort }}">← Previous</a>
        {% endif %}
        <span style="margin: 0 10px; color: #6c757d;">Page {{ (offset // limit) + 1 }}</span>
        {% if messages|length == limit %}
        <a href="/messages?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next →</a>
        {% endif %}
    </div>
    
    {% for message in messages %}
    <div class="message">
        <div class="username">{{ message.username }}</div>
        <div class="content">{{ message.content }}</div>
        <div class="timestamp">Posted: {{ message.created_at }}</div>
    </div>
    {% endfor %}
    {% else %}
    <div class="no-messages">
        <p>No messages yet. Be the first to post!</p>
    </div>
    {% endif %}
    
    <script>
    (function() {
        const form = document.getElementById('message-form');
        const statusDiv = document.getElementById('status-message');
        const csrfToken = {{ csrf_token|tojson }};
        
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value.trim();
            const content = document.getElementById('content').value.trim();
            
            if (!username || !content) {
                statusDiv.innerHTML = '<div class="status error">Please fill in all fields</div>';
                return;
            }
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    body: JSON.stringify({
                        username: username,
                        content: content
                    })
                });
                
                if (response.ok) {
                    statusDiv.innerHTML = '<div class="status success">Message posted successfully!</div>';
                    form.reset();
                    setTimeout(() => location.reload(), 1000);
                } else {
                    const data = await response.json().catch(() => ({}));
                    statusDiv.innerHTML = '<div class="status error">' + (data.error || 'Failed to post message') + '</div>';
                }
            } catch (err) {
                statusDiv.innerHTML = '<div class="status error">Network error. Please try again.</div>';
            }
        });
    })();
    </script>
</body>
</html>'''

@app.route('/messages', methods=['GET', 'POST'])
def messages():
    if request.method == 'GET':
        conn = None
        try:
            # Parse and validate query parameters
            try:
                limit = int(request.args.get('limit', 10))
                offset = int(request.args.get('offset', 0))
            except (TypeError, ValueError):
                limit, offset = 10, 0
            
            sort = str(request.args.get('sort', 'desc')).upper()
            
            # Enforce reasonable limits
            limit = min(max(1, limit), 100)
            offset = max(0, offset)
            sort = 'DESC' if sort != 'ASC' else 'ASC'
            
            # Query database
            conn = sqlite3.connect('db.sqlite3')
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute(
                f"SELECT id, username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?",
                (limit, offset)
            )
            rows = cursor.fetchall()
            
            # Prepare escaped messages
            messages = []
            for row in rows:
                messages.append({
                    'id': row['id'],
                    'username': escape(row['username']),
                    'content': escape(row['content']),
                    'created_at': row['created_at']
                })
            
            # Generate CSRF token
            csrf_token = generate_csrf_token()
            
            # Render template
            html = render_template_string(
                HTML_TEMPLATE,
                messages=messages,
                limit=limit,
                offset=offset,
                sort=sort.lower(),
                csrf_token=csrf_token,
                max=max
            )
            
            response = make_response(html)
            response.headers['Content-Type'] = 'text/html; charset=utf-8'
            return response
            
        except Exception:
            return make_response("An error occurred", 500)
        finally:
            if conn:
                conn.close()
    
    elif request.method == 'POST':
        conn = None
        try:
            # Verify JSON content type
            if not request.is_json:
                return jsonify({"error": "Content-Type must be application/json"}), 400
            
            # CSRF validation
            csrf_token = request.headers.get('X-CSRF-Token', '')
            if session.get('_csrf_token'):
                if not csrf_token or not secrets.compare_digest(session['_csrf_token'], csrf_token):
                    return jsonify({"error": "CSRF validation failed"}), 403
            
            # Parse request data
            data = request.get_json(silent=True)
            if not isinstance(data, dict):
                return jsonify({"error": "Invalid request data"}), 400
            
            username = data.get('username', '')
            content = data.get('content', '')
            
            # Validate inputs
            if not username or not content:
                return jsonify({"error": "Username and content are required"}), 400
            
            # Type checking and length limits
            if not isinstance(username, str) or not isinstance(content, str):
                return jsonify({"error": "Invalid data type"}), 400
                
            username = username.strip()[:100]
            content = content.strip()[:1000]
            
            if not username or not content:
                return jsonify({"error": "Username and content cannot be empty"}), 400
            
            # Insert into database
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO messages (username, content) VALUES (?, ?)",
                (username, content)
            )
            conn.commit()
            
            return jsonify({"status": "success"}), 200
            
        except json.JSONDecodeError:
            return jsonify({"error": "Invalid JSON"}), 400
        except sqlite3.IntegrityError:
            return jsonify({"error": "Invalid data"}), 400
        except Exception:
            return jsonify({"error": "An error occurred"}), 400
        finally:
            if conn:
                conn.close()

# Error handlers
@app.errorhandler(400)
def bad_request(e):
    if request.path == '/messages' and request.method == 'POST':
        return jsonify({"error": "Bad request"}), 400
    return "Bad request", 400

@app.errorhandler(403)
def forbidden(e):
    if request.path == '/messages' and request.method == 'POST':
        return jsonify({"error": "Forbidden"}), 403
    return "Forbidden", 403

@app.errorhandler(404)
def not_found(e):
    return "Not found", 404

@app.errorhandler(500)
def internal_error(e):
    if request.path == '/messages' and request.method == 'POST':
        return jsonify({"error": "Internal server error"}), 500
    return "Internal server error", 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)