from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime
import secrets
import html
import difflib
from contextlib import contextmanager

app = Flask(__name__)

# Database setup
DB_NAME = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DB_NAME)
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
            prev_content TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries(id)
        )
    ''')
    conn.commit()
    conn.close()

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Helper function to escape HTML
def escape_html(text):
    return html.escape(text) if text else ''

# CSRF protection for JSON endpoints
def verify_json_request():
    content_type = request.headers.get('Content-Type', '')
    if 'application/json' not in content_type:
        return False
    return True

# Routes
@app.route('/entries', methods=['GET', 'POST'])
def entries():
    if request.method == 'GET':
        try:
            with get_db() as conn:
                cursor = conn.execute('SELECT id, title FROM entries ORDER BY title')
                entries_list = cursor.fetchall()
            
            html_content = '''<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>
'''
            
            for entry in entries_list:
                html_content += f'<li><a href="/entries/{escape_html(entry["id"])}">{escape_html(entry["title"])}</a></li>\n'
            
            html_content += '''    </ul>
</body>
</html>'''
            
            return html_content, 200
        except Exception:
            return "An error occurred", 500
    
    elif request.method == 'POST':
        try:
            if not verify_json_request():
                return jsonify({"error": "Invalid content type"}), 400
            
            data = request.get_json()
            if not data:
                return jsonify({"error": "Invalid request"}), 400
            
            if 'title' not in data or 'content' not in data or 'createdBy' not in data:
                return jsonify({"error": "Missing required fields"}), 400
            
            title = data['title']
            content = data['content']
            created_by = data['createdBy']
            
            if not title or not content or not created_by:
                return jsonify({"error": "Title, content, and createdBy cannot be empty"}), 400
            
            entry_id = secrets.token_urlsafe(16)
            now = datetime.utcnow().isoformat()
            
            with get_db() as conn:
                conn.execute(
                    'INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    (entry_id, title, content, created_by, now, created_by, now)
                )
                conn.commit()
            
            return jsonify({
                'id': entry_id,
                'title': title,
                'content': content,
                'lastModifiedBy': created_by,
                'lastModifiedAt': now
            }), 201
        except Exception:
            return jsonify({"error": "An error occurred"}), 500

@app.route('/entries/<entry_id>', methods=['GET', 'PUT'])
def entry(entry_id):
    if request.method == 'GET':
        try:
            with get_db() as conn:
                cursor = conn.execute(
                    'SELECT * FROM entries WHERE id = ?',
                    (entry_id,)
                )
                entry_data = cursor.fetchone()
                
                if not entry_data:
                    return "Entry not found", 404
                
                # Get all contributors
                cursor = conn.execute(
                    'SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?',
                    (entry_id,)
                )
                edit_contributors = [row['modified_by'] for row in cursor.fetchall()]
                
                all_contributors = list(set([entry_data['created_by']] + edit_contributors))
                
                html_content = f'''<!DOCTYPE html>
<html>
<head>
    <title>{escape_html(entry_data["title"])}</title>
</head>
<body>
    <h1>{escape_html(entry_data["title"])}</h1>
    <p>Last modified: {escape_html(entry_data["last_modified_at"])} by {escape_html(entry_data["last_modified_by"])}</p>
    <p>Contributors: {escape_html(", ".join(all_contributors))}</p>
    <pre>{escape_html(entry_data["content"])}</pre>
    <p><a href="/entries/{escape_html(entry_id)}/edits">View Edit History</a></p>
    <p><a href="/entries">Back to all entries</a></p>
</body>
</html>'''
                
                return html_content, 200
        except Exception:
            return "An error occurred", 500
    
    elif request.method == 'PUT':
        try:
            if not verify_json_request():
                return jsonify({"error": "Invalid content type"}), 400
            
            data = request.get_json()
            if not data:
                return jsonify({"error": "Invalid request"}), 400
            
            if 'content' not in data or 'modifiedBy' not in data or 'summary' not in data:
                return jsonify({"error": "Missing required fields"}), 400
            
            content = data['content']
            modified_by = data['modifiedBy']
            summary = data['summary']
            
            if not content or not modified_by:
                return jsonify({"error": "Content and modifiedBy cannot be empty"}), 400
            
            with get_db() as conn:
                cursor = conn.execute(
                    'SELECT * FROM entries WHERE id = ?',
                    (entry_id,)
                )
                entry_data = cursor.fetchone()
                
                if not entry_data:
                    return jsonify({"error": "Entry not found"}), 404
                
                prev_content = entry_data['content']
                now = datetime.utcnow().isoformat()
                
                # Store the edit history
                conn.execute(
                    'INSERT INTO edits (entry_id, content, modified_by, modified_at, summary, prev_content) VALUES (?, ?, ?, ?, ?, ?)',
                    (entry_id, content, modified_by, now, summary, prev_content)
                )
                
                # Update the entry
                conn.execute(
                    'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
                    (content, modified_by, now, entry_id)
                )
                conn.commit()
                
                cursor = conn.execute(
                    'SELECT * FROM entries WHERE id = ?',
                    (entry_id,)
                )
                updated_entry = cursor.fetchone()
            
            return jsonify({
                'id': updated_entry['id'],
                'title': updated_entry['title'],
                'content': updated_entry['content'],
                'lastModifiedBy': updated_entry['last_modified_by'],
                'lastModifiedAt': updated_entry['last_modified_at']
            }), 200
        except Exception:
            return jsonify({"error": "An error occurred"}), 500

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def entry_edits(entry_id):
    try:
        with get_db() as conn:
            cursor = conn.execute(
                'SELECT * FROM entries WHERE id = ?',
                (entry_id,)
            )
            entry_data = cursor.fetchone()
            
            if not entry_data:
                return "Entry not found", 404
            
            cursor = conn.execute(
                'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC',
                (entry_id,)
            )
            edits_list = cursor.fetchall()
            
            html_content = f'''<!DOCTYPE html>
<html>
<head>
    <title>Edit History - {escape_html(entry_data["title"])}</title>
</head>
<body>
    <h1>Edit History - {escape_html(entry_data["title"])}</h1>
'''
            
            for edit in edits_list:
                prev = edit['prev_content'] or ''
                curr = edit['content']
                
                # Generate diff
                diff_lines = list(difflib.unified_diff(
                    prev.splitlines(keepends=True),
                    curr.splitlines(keepends=True),
                    lineterm=''
                ))
                
                diff_html = '<pre>'
                for line in diff_lines:
                    diff_html += escape_html(line) + '\n'
                diff_html += '</pre>'
                
                summary_value = edit["summary"]
                if summary_value:
                    summary_text = f'Summary: {escape_html(summary_value)}'
                else:
                    summary_text = 'No summary provided'
                
                html_content += f'''
    <div>
        <h3>Modified: {escape_html(edit["modified_at"])} by {escape_html(edit["modified_by"])}</h3>
        <p>{summary_text}</p>
        {diff_html}
    </div>
    <hr>
'''
            
            html_content += f'''
    <p><a href="/entries/{escape_html(entry_id)}">Back to entry</a></p>
    <p><a href="/entries">Back to all entries</a></p>
</body>
</html>'''
            
            return html_content, 200
    except Exception:
        return "An error occurred", 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)