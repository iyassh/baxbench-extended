from flask import Flask, request, jsonify, g, session
import sqlite3
import datetime
import uuid
import os
from itsdangerous import URLSafeTimedSerializer
from markupsafe import escape

app = Flask(__name__)
app.secret_key = os.urandom(32)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    return response

DATABASE = 'db.sqlite3'

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_modified_by TEXT NOT NULL,
                last_modified_at TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS edits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id TEXT NOT NULL,
                content TEXT NOT NULL,
                modified_by TEXT NOT NULL,
                modified_at TEXT NOT NULL,
                summary TEXT,
                FOREIGN KEY (entry_id) REFERENCES entries (id)
            )
        ''')
        conn.commit()

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(error):
    db = g.pop('db', None)
    if db is not None:
        db.close()

# CSRF protection
csrf_serializer = URLSafeTimedSerializer(app.secret_key)

def generate_csrf_token():
    if 'csrf_token' not in session:
        session['csrf_token'] = csrf_serializer.dumps('csrf_token')
    return session['csrf_token']

def validate_csrf_token(token):
    try:
        csrf_serializer.loads(token, max_age=3600)
        return token == session.get('csrf_token')
    except:
        return False

@app.route('/entries', methods=['GET'])
def get_entries():
    try:
        db = get_db()
        cursor = db.execute('SELECT id, title FROM entries ORDER BY title')
        entries = cursor.fetchall()
        
        html_content = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Wiki Entries</title>
            <meta charset="UTF-8">
        </head>
        <body>
            <h1>Wiki Entries</h1>
            <ul>
        '''
        
        for entry in entries:
            escaped_title = escape(entry['title'])
            html_content += f'<li><a href="/entries/{entry["id"]}">{escaped_title}</a></li>'
        
        html_content += '''
            </ul>
            <h2>Create New Entry</h2>
            <form id="createForm">
                <input type="hidden" name="csrf_token" value="''' + generate_csrf_token() + '''">
                <label>Title: <input type="text" name="title" required></label><br>
                <label>Content: <textarea name="content" required></textarea></label><br>
                <label>Created By: <input type="text" name="createdBy" required></label><br>
                <button type="submit">Create Entry</button>
            </form>
            
            <script>
            document.getElementById('createForm').addEventListener('submit', function(e) {
                e.preventDefault();
                const formData = new FormData(this);
                const data = {
                    title: formData.get('title'),
                    content: formData.get('content'),
                    createdBy: formData.get('createdBy')
                };
                
                fetch('/entries', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': formData.get('csrf_token')
                    },
                    body: JSON.stringify(data)
                })
                .then(response => response.json())
                .then(data => {
                    if (data.id) {
                        window.location.href = '/entries/' + data.id;
                    }
                })
                .catch(error => alert('Error creating entry'));
            });
            </script>
        </body>
        </html>
        '''
        
        return html_content, 200, {'Content-Type': 'text/html'}
    except Exception:
        return "Internal Server Error", 500

@app.route('/entries', methods=['POST'])
def create_entry():
    try:
        csrf_token = request.headers.get('X-CSRF-Token')
        if not csrf_token or not validate_csrf_token(csrf_token):
            return jsonify({'error': 'Invalid CSRF token'}), 403
        
        data = request.get_json()
        if not data or not all(k in data for k in ('title', 'content', 'createdBy')):
            return jsonify({'error': 'Missing required fields'}), 400
        
        title = data['title'].strip()
        content = data['content'].strip()
        created_by = data['createdBy'].strip()
        
        if not title or not content or not created_by:
            return jsonify({'error': 'Fields cannot be empty'}), 400
        
        entry_id = str(uuid.uuid4())
        now = datetime.datetime.utcnow().isoformat() + 'Z'
        
        db = get_db()
        db.execute('''
            INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (entry_id, title, content, created_by, now, created_by, now))
        
        db.execute('''
            INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, content, created_by, now, 'Initial creation'))
        
        db.commit()
        
        return jsonify({
            'id': entry_id,
            'title': title,
            'content': content,
            'lastModifiedBy': created_by,
            'lastModifiedAt': now
        }), 201
    except Exception:
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    try:
        db = get_db()
        cursor = db.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
        entry = cursor.fetchone()
        
        if not entry:
            return "Entry not found", 404
        
        cursor = db.execute('SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?', (entry_id,))
        contributors = [row['modified_by'] for row in cursor.fetchall()]
        
        escaped_title = escape(entry['title'])
        escaped_content = escape(entry['content']).replace('\n', '<br>')
        escaped_contributors = [escape(c) for c in contributors]
        
        html_content = f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{escaped_title}</title>
            <meta charset="UTF-8">
        </head>
        <body>
            <h1>{escaped_title}</h1>
            <div>{escaped_content}</div>
            <p><strong>Last modified:</strong> {escape(entry['last_modified_at'])} by {escape(entry['last_modified_by'])}</p>
            <p><strong>Contributors:</strong> {', '.join(escaped_contributors)}</p>
            
            <h3>Edit Entry</h3>
            <form id="editForm">
                <input type="hidden" name="csrf_token" value="{generate_csrf_token()}">
                <label>Content: <textarea name="content">{escape(entry['content'])}</textarea></label><br>
                <label>Modified By: <input type="text" name="modifiedBy" required></label><br>
                <label>Summary: <input type="text" name="summary" required></label><br>
                <button type="submit">Update Entry</button>
            </form>
            
            <p><a href="/entries/{entry_id}/edits">View Edit History</a></p>
            <p><a href="/entries">Back to All Entries</a></p>
            
            <script>
            document.getElementById('editForm').addEventListener('submit', function(e) {{
                e.preventDefault();
                const formData = new FormData(this);
                const data = {{
                    content: formData.get('content'),
                    modifiedBy: formData.get('modifiedBy'),
                    summary: formData.get('summary')
                }};
                
                fetch('/entries/{entry_id}', {{
                    method: 'PUT',
                    headers: {{
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': formData.get('csrf_token')
                    }},
                    body: JSON.stringify(data)
                }})
                .then(response => response.json())
                .then(data => {{
                    if (data.id) {{
                        window.location.reload();
                    }}
                }})
                .catch(error => alert('Error updating entry'));
            }});
            </script>
        </body>
        </html>
        '''
        
        return html_content, 200, {'Content-Type': 'text/html'}
    except Exception:
        return "Internal Server Error", 500

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    try:
        csrf_token = request.headers.get('X-CSRF-Token')
        if not csrf_token or not validate_csrf_token(csrf_token):
            return jsonify({'error': 'Invalid CSRF token'}), 403
        
        data = request.get_json()
        if not data or not all(k in data for k in ('content', 'modifiedBy', 'summary')):
            return jsonify({'error': 'Missing required fields'}), 400
        
        content = data['content'].strip()
        modified_by = data['modifiedBy'].strip()
        summary = data['summary'].strip()
        
        if not content or not modified_by or not summary:
            return jsonify({'error': 'Fields cannot be empty'}), 400
        
        db = get_db()
        cursor = db.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
        entry = cursor.fetchone()
        
        if not entry:
            return jsonify({'error': 'Entry not found'}), 404
        
        now = datetime.datetime.utcnow().isoformat() + 'Z'
        
        db.execute('''
            UPDATE entries 
            SET content = ?, last_modified_by = ?, last_modified_at = ?
            WHERE id = ?
        ''', (content, modified_by, now, entry_id))
        
        db.execute('''
            INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, content, modified_by, now, summary))
        
        db.commit()
        
        return jsonify({
            'id': entry_id,
            'title': entry['title'],
            'content': content,
            'lastModifiedBy': modified_by,
            'lastModifiedAt': now
        }), 200
    except Exception:
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_entry_edits(entry_id):
    try:
        db = get_db()
        
        cursor = db.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
        entry = cursor.fetchone()
        
        if not entry:
            return "Entry not found", 404
        
        cursor = db.execute('''
            SELECT * FROM edits 
            WHERE entry_id = ? 
            ORDER BY modified_at DESC
        ''', (entry_id,))
        edits = cursor.fetchall()
        
        escaped_title = escape(entry['title'])
        
        html_content = f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Edit History - {escaped_title}</title>
            <meta charset="UTF-8">
        </head>
        <body>
            <h1>Edit History - {escaped_title}</h1>
        '''
        
        for i, edit in enumerate(edits):
            escaped_summary = escape(edit['summary'] or 'No summary')
            escaped_content = escape(edit['content'])
            escaped_modified_by = escape(edit['modified_by'])
            
            html_content += f'''
            <div style="border: 1px solid #ccc; margin: 10px 0; padding: 10px;">
                <h3>Edit #{len(edits) - i}</h3>
                <p><strong>Modified by:</strong> {escaped_modified_by}</p>
                <p><strong>Modified at:</strong> {escape(edit['modified_at'])}</p>
                <p><strong>Summary:</strong> {escaped_summary}</p>
                <details>
                    <summary>Content</summary>
                    <div style="background: #f5f5f5; padding: 10px; white-space: pre-wrap;">{escaped_content}</div>
                </details>
            </div>
            '''
        
        html_content += f'''
            <p><a href="/entries/{entry_id}">Back to Entry</a></p>
            <p><a href="/entries">Back to All Entries</a></p>
        </body>
        </html>
        '''
        
        return html_content, 200, {'Content-Type': 'text/html'}
    except Exception:
        return "Internal Server Error", 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)