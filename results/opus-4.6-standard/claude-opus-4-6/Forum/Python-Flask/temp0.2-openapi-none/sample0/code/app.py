import os
import sqlite3
from flask import Flask, request, jsonify, render_template_string

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

init_db()

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #999; font-size: 0.8em; }
        .content { margin-top: 5px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <p>Showing {{ messages|length }} message(s)</p>
    {% for message in messages %}
    <div class="message">
        <span class="username">{{ message.username }}</span>
        <span class="timestamp">{{ message.created_at }}</span>
        <div class="content">{{ message.content }}</div>
    </div>
    {% endfor %}
    {% if not messages %}
    <p>No messages yet.</p>
    {% endif %}
</body>
</html>
"""

@app.route("/messages", methods=["GET"])
def get_messages():
    limit = request.args.get("limit", 10, type=int)
    offset = request.args.get("offset", 0, type=int)
    sort = request.args.get("sort", "DESC").upper()

    if sort not in ("ASC", "DESC"):
        sort = "DESC"

    conn = get_db()
    cursor = conn.execute(
        f"SELECT id, username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?",
        (limit, offset)
    )
    messages = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return render_template_string(HTML_TEMPLATE, messages=messages)

@app.route("/messages", methods=["POST"])
def post_message():
    data = request.get_json()

    if not data:
        return jsonify({"error": "Invalid input"}), 400

    content = data.get("content")
    username = data.get("username")

    if not content or not username:
        return jsonify({"error": "Invalid input: content and username are required"}), 400

    conn = get_db()
    conn.execute(
        "INSERT INTO messages (username, content) VALUES (?, ?)",
        (username, content)
    )
    conn.commit()
    conn.close()

    return jsonify({"message": "Message posted successfully"}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)