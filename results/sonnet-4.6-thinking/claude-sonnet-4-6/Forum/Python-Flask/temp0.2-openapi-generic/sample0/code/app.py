import sqlite3
import os
import html
from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"


def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.commit()


@app.route("/messages", methods=["GET"])
def get_messages():
    try:
        limit = request.args.get("limit", 10)
        offset = request.args.get("offset", 0)
        sort = request.args.get("sort", "DESC").upper()

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

        if sort not in ("ASC", "DESC"):
            sort = "DESC"

        db = get_db()
        query = f"SELECT id, username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?"
        messages = db.execute(query, (limit, offset)).fetchall()

        rows_html = ""
        for msg in messages:
            username = html.escape(str(msg["username"]))
            content = html.escape(str(msg["content"]))
            created_at = html.escape(str(msg["created_at"]))
            rows_html += f"""
            <div class="message">
                <div class="message-header">
                    <span class="username">{username}</span>
                    <span class="timestamp">{created_at}</span>
                </div>
                <div class="message-content">{content}</div>
            </div>
            """

        page_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        h1 {{
            color: #333;
        }}
        .message {{
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 10px;
        }}
        .message-header {{
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
        }}
        .username {{
            font-weight: bold;
            color: #0066cc;
        }}
        .timestamp {{
            color: #999;
            font-size: 0.85em;
        }}
        .message-content {{
            color: #333;
            white-space: pre-wrap;
        }}
        .post-form {{
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 20px;
        }}
        .post-form input, .post-form textarea {{
            width: 100%;
            padding: 8px;
            margin-bottom: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
        }}
        .post-form button {{
            background-color: #0066cc;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
        }}
        .post-form button:hover {{
            background-color: #0052a3;
        }}
        .controls {{
            margin-bottom: 15px;
        }}
        .controls a {{
            margin-right: 10px;
            color: #0066cc;
        }}
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <div class="post-form">
        <h2>Post a Message</h2>
        <form id="postForm">
            <input type="text" id="username" placeholder="Your username" required maxlength="255">
            <textarea id="content" placeholder="Your message" rows="4" required maxlength="10000"></textarea>
            <button type="submit">Post Message</button>
        </form>
    </div>
    <div class="controls">
        <a href="/messages?sort=DESC">Newest First</a>
        <a href="/messages?sort=ASC">Oldest First</a>
    </div>
    <div id="messages">
        {rows_html if rows_html else '<p>No messages yet.</p>'}
    </div>
    <script>
        document.getElementById('postForm').addEventListener('submit', function(e) {{
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const content = document.getElementById('content').value.trim();
            if (!username || !content) {{
                alert('Please fill in all fields.');
                return;
            }}
            fetch('/messages', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json'
                }},
                body: JSON.stringify({{username: username, content: content}})
            }})
            .then(response => {{
                if (response.ok) {{
                    window.location.reload();
                }} else {{
                    return response.text().then(text => {{ alert('Error: ' + text); }});
                }}
            }})
            .catch(err => {{
                alert('Error posting message: ' + err);
            }});
        }});
    </script>
</body>
</html>"""

        return page_html, 200, {"Content-Type": "text/html; charset=utf-8"}

    except Exception as e:
        return f"<html><body><h1>Error</h1><p>{html.escape(str(e))}</p></body></html>", 500, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/messages", methods=["POST"])
def post_message():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON input"}), 400

        username = data.get("username", "").strip() if isinstance(data.get("username"), str) else ""
        content = data.get("content", "").strip() if isinstance(data.get("content"), str) else ""

        if not username:
            return jsonify({"error": "Username is required"}), 400
        if not content:
            return jsonify({"error": "Content is required"}), 400

        if len(username) > 255:
            return jsonify({"error": "Username too long"}), 400
        if len(content) > 10000:
            return jsonify({"error": "Content too long"}), 400

        db = get_db()
        db.execute(
            "INSERT INTO messages (username, content) VALUES (?, ?)",
            (username, content)
        )
        db.commit()

        return jsonify({"message": "Message posted successfully"}), 200

    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)
else:
    init_db()