from flask import Flask, request, render_template_string
import sqlite3
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            username TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# HTML template for messages display
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; }
        .username { font-weight: bold; }
        .content { margin-top: 5px; }
        .timestamp { color: #666; font-size: 0.9em; }
        .pagination { margin-top: 20px; }
        .pagination a { margin: 0 5px; }
    </style>
</head>
<body>
    <h1>MyForum Messages</h1>
    
    {% if messages %}
    <div class="messages">
        {% for message in messages %}
        <div class="message">
            <div class="username">{{ message.username }}</div>
            <div class="content">{{ message.content }}</div>
            <div class="timestamp">{{ message.created_at }}</div>
        </div>
        {% endfor %}
    </div>
    
    <div class="pagination">
        {% if offset > 0 %}
        <a href="?limit={{ limit }}&offset={{ offset - limit if offset - limit >= 0 else 0 }}&sort={{ sort }}">Previous</a>
        {% endif %}
        
        {% if messages|length == limit %}
        <a href="?limit={{ limit }}&offset={{ offset + limit }}&sort={{ sort }}">Next</a>
        {% endif %}
    </div>
    {% else %}
    <p>No messages yet.</p>
    {% endif %}
    
    <hr>
    <p>Sort: <a href="?limit={{ limit }}&offset=0&sort=ASC">Oldest First</a> | 
              <a href="?limit={{ limit }}&offset=0&sort=DESC">Newest First</a></p>
    <p>Page size: <a href="?limit=5&offset=0&sort={{ sort }}">5</a> | 
                  <a href="?limit=10&offset=0&sort={{ sort }}">10</a> | 
                  <a href="?limit=20&offset=0&sort={{ sort }}">20</a></p>
</body>
</html>
'''

@app.route('/messages', methods=['GET', 'POST'])
def messages():
    if request.method == 'GET':
        # Get query parameters with defaults
        limit = request.args.get('limit', 10, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort = request.args.get('sort', 'desc')
        
        # Map sort parameter to SQL ORDER BY value
        # Accept enum values [ASC, DESC] and also the default 'desc'
        if sort in ['ASC', 'DESC']:
            sort_sql = sort
        elif sort == 'desc':
            sort_sql = 'DESC'
        else:
            # Invalid value, use default
            sort_sql = 'DESC'
            sort = 'DESC'
        
        # Get messages from database
        conn = get_db()
        cursor = conn.execute('''
            SELECT * FROM messages 
            ORDER BY created_at {}
            LIMIT ? OFFSET ?
        '''.format(sort_sql), (limit, offset))
        messages = cursor.fetchall()
        conn.close()
        
        # Convert Row objects to dictionaries for template
        messages_list = [dict(msg) for msg in messages]
        
        # Render HTML template
        return render_template_string(HTML_TEMPLATE, 
                                    messages=messages_list,
                                    limit=limit,
                                    offset=offset,
                                    sort=sort)
    
    elif request.method == 'POST':
        # Get JSON data
        data = request.get_json()
        
        # Validate input
        if not data or 'content' not in data or 'username' not in data:
            return '', 400
        
        content = data.get('content')
        username = data.get('username')
        
        # Validate that content and username are strings and not empty
        if not isinstance(content, str) or not isinstance(username, str):
            return '', 400
        
        if not content.strip() or not username.strip():
            return '', 400
        
        # Insert message into database
        conn = get_db()
        conn.execute(
            'INSERT INTO messages (content, username) VALUES (?, ?)',
            (content, username)
        )
        conn.commit()
        conn.close()
        
        return '', 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)