import os
import sqlite3
from flask import Flask, request, jsonify, g, render_template_string

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
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
    db.close()


MESSAGES_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum - Messages</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ccc; border-radius: 5px; padding: 10px; margin-bottom: 10px; }
        .message .username { font-weight: bold; color: #333; }
        .message .content { margin-top: 5px; }
        .message .timestamp { font-size: 0.8em; color: #999; margin-top: 5px; }
        h1 { color: #333; }
        .pagination { margin-top: 20px; }
        .pagination a { margin-right: 10px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <p>Total messages: {{ total }}</p>
    {% if messages %}
        {% for message in messages %}
        <div class="message">
            <div class="username">{{ message.username }}</div>
            <div class="content">{{ message.content }}</div>
            <div class="timestamp">{{ message.created_at }}</div>
        </div>
        {% endfor %}
    {% else %}
        <p>No messages yet.</p>
    {% endif %}
    <div class="pagination">
        {% if offset > 0 %}
            <a href="?limit={{ limit }}&offset={{ [0, offset - limit]|max }}&sort={{ sort }}">Previous</a>
        {% endif %}
        {% if offset + limit < total %}
            <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next</a>
        {% endif %}
    </div>
</body>
</html>
"""


@app.route("/messages", methods=["GET"])
def get_messages():
    try:
        limit = request.args.get("limit", 10, type=int)
        offset = request.args.get("offset", 0, type=int)
        sort = request.args.get("sort", "DESC").upper()
    except (ValueError, TypeError):
        return "Invalid parameters", 400

    if limit < 0:
        limit = 10
    if offset < 0:
        offset = 0
    if sort not in ("ASC", "DESC"):
        sort = "DESC"

    # Cap limit to prevent abuse
    if limit > 100:
        limit = 100

    db = get_db()

    total_row = db.execute("SELECT COUNT(*) as cnt FROM messages").fetchone()
    total = total_row["cnt"]

    query = f"SELECT username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?"
    messages = db.execute(query, (limit, offset)).fetchall()

    return render_template_string(
        MESSAGES_TEMPLATE,
        messages=messages,
        total=total,
        limit=limit,
        offset=offset,
        sort=sort,
    )


@app.route("/messages", methods=["POST"])
def post_message():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400

    content = data.get("content")
    username = data.get("username")

    if not content or not isinstance(content, str) or not content.strip():
        return jsonify({"error": "Content is required and must be a non-empty string"}), 400

    if not username or not isinstance(username, str) or not username.strip():
        return jsonify({"error": "Username is required and must be a non-empty string"}), 400

    content = content.strip()
    username = username.strip()

    # Limit lengths
    if len(content) > 5000:
        return jsonify({"error": "Content too long (max 5000 characters)"}), 400
    if len(username) > 100:
        return jsonify({"error": "Username too long (max 100 characters)"}), 400

    db = get_db()
    db.execute(
        "INSERT INTO messages (username, content) VALUES (?, ?)",
        (username, content),
    )
    db.commit()

    return jsonify({"message": "Message posted successfully"}), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)