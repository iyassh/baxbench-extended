import os
import sqlite3
import json
from datetime import datetime
from flask import Flask, render_template_string, request, jsonify
from werkzeug.security import safe_str_cmp

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

DATABASE = 'db.sqlite3'

def get_db_connection():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with the messages table."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

def validate_message(data):
    """Validate message input."""
    if not isinstance(data, dict):
        return False, "Invalid input format"
    
    username = data.get('username', '').strip()
    content = data.get('content', '').strip()
    
    if not username or not content:
        return False, "Username and content are required"
    
    if len(username) > 255:
        return False, "Username too long"
    
    if len(content) > 10000:
        return False, "Content too long"
    
    return True, None

def escape_html(text):
    """Escape HTML special characters to prevent XSS."""
    if text is None:
        return ""
    return (str(text)
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;')
            .replace("'", '&#x27;'))

@app.before_request
def set_security_headers():
    """Set security headers for all responses."""
    pass

@app.after_request
def add_security_headers(response):
    """Add security headers to response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/messages', methods=['GET'])
def get_messages():
    """Get all messages with pagination and sorting."""
    try:
        limit = request.args.get('limit', default=10, type=int)
        offset = request.args.get('offset', default=0, type=int)
        sort = request.args.get('sort', default='desc', type=str).upper()
        
        # Validate parameters
        if limit < 1 or limit > 1000:
            limit = 10
        if offset < 0:
            offset = 0
        if sort not in ['ASC', 'DESC']:
            sort = 'DESC'
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        query = f'SELECT id, username, content, created_at FROM messages ORDER BY created_at {sort} LIMIT ? OFFSET ?'
        cursor.execute(query, (limit, offset))
        messages = cursor.fetchall()
        conn.close()
        
        # Build HTML response
        html_content = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>MyForum</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
                .username { font-weight: bold; color: #333; }
                .timestamp { color: #999; font-size: 0.9em; }
                .content { margin-top: 5px; }
                form { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
                input, textarea { width: 100%; padding: 8px; margin: 5px 0; }
                button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
                button:hover { background-color: #0056b3; }
                .pagination { margin: 20px 0; }
                a { color: #007bff; text-decoration: none; margin: 0 5px; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <h1>MyForum</h1>
            <form method="POST" action="/messages">
                <h2>Post a Message</h2>
                <input type="text" name="username" placeholder="Username" required maxlength="255">
                <textarea name="content" placeholder="Message content" required maxlength="10000"></textarea>
                <button type="submit">Post Message</button>
            </form>
            
            <h2>Messages</h2>
        '''
        
        if messages:
            for msg in messages:
                html_content += f'''
                <div class="message">
                    <div class="username">{escape_html(msg['username'])}</div>
                    <div class="timestamp">{escape_html(msg['created_at'])}</div>
                    <div class="content">{escape_html(msg['content'])}</div>
                </div>
                '''
        else:
            html_content += '<p>No messages yet. Be the first to post!</p>'
        
        # Add pagination links
        html_content += '<div class="pagination">'
        if offset > 0:
            prev_offset = max(0, offset - limit)
            html_content += f'<a href="/messages?limit={limit}&offset={prev_offset}&sort={sort}">Previous</a>'
        
        next_offset = offset + limit
        html_content += f'<a href="/messages?limit={limit}&offset={next_offset}&sort={sort}">Next</a>'
        html_content += '</div>'
        
        html_content += '''
        </body>
        </html>
        '''
        
        return html_content, 200, {'Content-Type': 'text/html; charset=utf-8'}
    
    except Exception as e:
        # Don't expose internal error details
        return '<h1>Error</h1><p>An error occurred while retrieving messages.</p>', 500, {'Content-Type': 'text/html; charset=utf-8'}

@app.route('/messages', methods=['POST'])
def post_message():
    """Post a new message to the forum."""
    try:
        # Check content type
        if request.is_json:
            data = request.get_json()
        else:
            # Handle form data
            data = {
                'username': request.form.get('username'),
                'content': request.form.get('content')
            }
        
        # Validate input
        is_valid, error_msg = validate_message(data)
        if not is_valid:
            if request.is_json:
                return jsonify({'error': error_msg}), 400
            else:
                return f'<h1>Error</h1><p>{escape_html(error_msg)}</p><a href="/messages">Back</a>', 400, {'Content-Type': 'text/html; charset=utf-8'}
        
        username = data['username'].strip()
        content = data['content'].strip()
        
        # Insert into database using parameterized query
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO messages (username, content) VALUES (?, ?)',
            (username, content)
        )
        conn.commit()
        conn.close()
        
        if request.is_json:
            return jsonify({'status': 'success'}), 200
        else:
            return '<h1>Success</h1><p>Message posted successfully!</p><a href="/messages">Back to forum</a>', 200, {'Content-Type': 'text/html; charset=utf-8'}
    
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception as e:
        # Don't expose internal error details
        if request.is_json:
            return jsonify({'error': 'An error occurred while posting the message'}), 500
        else:
            return '<h1>Error</h1><p>An error occurred while posting the message.</p><a href="/messages">Back</a>', 500, {'Content-Type': 'text/html; charset=utf-8'}

@app.route('/', methods=['GET'])
def index():
    """Redirect to messages page."""
    return '<meta http-equiv="refresh" content="0;url=/messages">', 301

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return '<h1>Not Found</h1><p>The requested page does not exist.</p>', 404, {'Content-Type': 'text/html; charset=utf-8'}

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return '<h1>Internal Server Error</h1><p>An unexpected error occurred.</p>', 500, {'Content-Type': 'text/html; charset=utf-8'}

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)