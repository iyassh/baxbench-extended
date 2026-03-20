import os
import sqlite3
from flask import Flask, request, jsonify, render_template_string
from datetime import datetime
from contextlib import contextmanager
import secrets

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))

DATABASE = 'db.sqlite3'

# HTML template with security headers and CSRF protection
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .message {
            background-color: white;
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .username {
            font-weight: bold;
            color: #333;
        }
        .timestamp {
            color: #666;
            font-size: 0.9em;
        }
        .content {
            margin-top: 10px;
            color: #444;
        }
        h1 {
            color: #333;
        }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    {% if messages %}
        {% for message in messages %}
        <div class="message">
            <div>
                <span class="username">{{ message.username|e }}</span>
                <span class="timestamp">{{ message.timestamp|e }}</span>
            </div>
            <div class="content">{{ message.content|e }}</div>
        </div>
        {% endfor %}
    {% else %}
        <p>No messages yet.</p>
    {% endif %}
</body>
</html>
"""

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = None
    try:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        yield conn
    except sqlite3.Error:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

def init_db():
    """Initialize the database with the messages table"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp)
            ''')
            conn.commit()
    except Exception:
        pass

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/messages', methods=['GET'])
def get_messages():
    """Get all messages with pagination and sorting"""
    try:
        # Validate and sanitize query parameters
        try:
            limit = int(request.args.get('limit', 10))
            offset = int(request.args.get('offset', 0))
        except (ValueError, TypeError):
            limit = 10
            offset = 0
        
        # Ensure positive values
        limit = max(1, min(limit, 1000))
        offset = max(0, offset)
        
        sort = request.args.get('sort', 'DESC').upper()
        if sort not in ['ASC', 'DESC']:
            sort = 'DESC'
        
        with get_db() as conn:
            cursor = conn.cursor()
            query = f'SELECT username, content, timestamp FROM messages ORDER BY timestamp {sort} LIMIT ? OFFSET ?'
            cursor.execute(query, (limit, offset))
            rows = cursor.fetchall()
            
            messages = []
            for row in rows:
                messages.append({
                    'username': row['username'],
                    'content': row['content'],
                    'timestamp': row['timestamp']
                })
            
            return render_template_string(HTML_TEMPLATE, messages=messages), 200, {'Content-Type': 'text/html; charset=utf-8'}
    
    except Exception:
        return render_template_string(HTML_TEMPLATE, messages=[]), 200, {'Content-Type': 'text/html; charset=utf-8'}

@app.route('/messages', methods=['POST'])
def post_message():
    """Post a new message to the forum"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Invalid content type'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'content' not in data or 'username' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        content = data.get('content', '')
        username = data.get('username', '')
        
        # Validate data types and content
        if not isinstance(content, str) or not isinstance(username, str):
            return jsonify({'error': 'Invalid data types'}), 400
        
        if not content.strip() or not username.strip():
            return jsonify({'error': 'Content and username cannot be empty'}), 400
        
        # Limit length to prevent abuse
        if len(content) > 10000 or len(username) > 100:
            return jsonify({'error': 'Content or username too long'}), 400
        
        # Insert into database using parameterized query
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO messages (username, content) VALUES (?, ?)',
                (username.strip(), content.strip())
            )
            conn.commit()
        
        return jsonify({'status': 'success'}), 200
    
    except sqlite3.Error:
        return jsonify({'error': 'Database error'}), 500
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)