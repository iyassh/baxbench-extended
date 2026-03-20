import sqlite3
import json
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string, abort, make_response, session
from werkzeug.exceptions import HTTPException
import difflib
import secrets
import html

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(32)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create entries table
    cursor.execute('''
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
    
    # Create edits table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id TEXT PRIMARY KEY,
            entry_id TEXT NOT NULL,
            content TEXT NOT NULL,
            previous_content TEXT,
            modified_by TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# CSRF token generation and validation
def generate_csrf_token():
    if '_csrf_token' not in session:
        session['_csrf_token'] = secrets.token_hex(16)
    return session['_csrf_token']

def validate_csrf_token():
    token = session.get('_csrf_token', None)
    if not token or (token != request.form.get('_csrf_token') and token != request.headers.get('X-CSRF-Token')):
        abort(403)

app.jinja_env.globals['csrf_token'] = generate_csrf_token

# Error handler
@app.errorhandler(Exception)
def handle_error(error):
    if isinstance(error, HTTPException):
        return jsonify({'error': 'An error occurred'}), error.code
    return jsonify({'error': 'Internal server error'}), 500

# HTML templates
ENTRIES_LIST_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 10px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .create-form { margin-top: 30px; padding: 20px; border: 1px solid #ddd; }
        input, textarea { width: 100%; margin: 5px 0; padding: 5px; }
        button { padding: 10px 20px; background-color: #0066cc; color: white; border: none; cursor: pointer; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>
        {% for entry in entries %}
        <li><a href="/entries/{{ entry.id }}">{{ entry.title|e }}</a></li>
        {% endfor %}
    </ul>
    
    <div class="create-form">
        <h2>Create New Entry</h2>
        <form id="createForm">
            <input type="text" id="title" placeholder="Title" required><br>
            <textarea id="content" placeholder="Content" rows="10" required></textarea><br>
            <input type="text" id="createdBy" placeholder="Your name" required><br>
            <button type="submit">Create Entry</button>
        </form>
    </div>
    
    <script>
    document.getElementById('createForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const response = await fetch('/entries', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': '{{ csrf_token() }}'
            },
            body: JSON.stringify({
                title: document.getElementById('title').value,
                content: document.getElementById('content').value,
                createdBy: document.getElementById('createdBy').value
            })
        });
        if (response.ok) {
            const data = await response.json();
            window.location.href = '/entries/' + data.id;
        }
    });
    </script>
</body>
</html>
'''

ENTRY_DETAIL_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ entry.title|e }} - Wiki</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .content { margin: 20px 0; line-height: 1.6; white-space: pre-wrap; }
        .metadata { color: #666; font-size: 0.9em; }
        .contributors { margin: 10px 0; }
        .edit-form { margin-top: 30px; padding: 20px; border: 1px solid #ddd; }
        textarea { width: 100%; margin: 5px 0; padding: 5px; }
        input { width: 100%; margin: 5px 0; padding: 5px; }
        button { padding: 10px 20px; background-color: #0066cc; color: white; border: none; cursor: pointer; }
        a { color: #0066cc; text-decoration: none; }
    </style>
</head>
<body>
    <h1>{{ entry.title|e }}</h1>
    <div class="metadata">
        Last modified by {{ entry.last_modified_by|e }} on {{ entry.last_modified_at }}
    </div>
    <div class="content">{{ entry.content|e }}</div>
    <div class="contributors">
        <strong>Contributors:</strong> {{ contributors|join(', ')|e }}
    </div>
    <p><a href="/entries/{{ entry.id }}/edits">View edit history</a></p>
    <p><a href="/entries">Back to all entries</a></p>
    
    <div class="edit-form">
        <h2>Edit Entry</h2>
        <form id="editForm">
            <textarea id="content" rows="10" required>{{ entry.content|e }}</textarea><br>
            <input type="text" id="modifiedBy" placeholder="Your name" required><br>
            <input type="text" id="summary" placeholder="Edit summary" required><br>
            <button type="submit">Update Entry</button>
        </form>
    </div>
    
    <script>
    document.getElementById('editForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const response = await fetch('/entries/{{ entry.id }}', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': '{{ csrf_token() }}'
            },
            body: JSON.stringify({
                content: document.getElementById('content').value,
                modifiedBy: document.getElementById('modifiedBy').value,
                summary: document.getElementById('summary').value
            })
        });
        if (response.ok) {
            window.location.reload();
        }
    });
    </script>
</body>
</html>
'''

EDIT_HISTORY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Edit History - {{ title|e }}</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { margin: 20px 0; padding: 15px; border: 1px solid #ddd; }
        .metadata { color: #666; font-size: 0.9em; margin-bottom: 10px; }
        .diff { background-color: #f5f5f5; padding: 10px; font-family: monospace; overflow-x: auto; }
        .diff-line { margin: 0; }
        .added { color: green; }
        .removed { color: red; }
        a { color: #0066cc; text-decoration: none; }
    </style>
</head>
<body>
    <h1>Edit History: {{ title|e }}</h1>
    <p><a href="/entries/{{ entry_id }}">Back to entry</a></p>
    
    {% for edit in edits %}
    <div class="edit">
        <div class="metadata">
            Edited by {{ edit.modified_by|e }} on {{ edit.modified_at }}
            {% if edit.summary %}
            <br>Summary: {{ edit.summary|e }}
            {% endif %}
        </div>
        <div class="diff">
            {% for line in edit.diff_lines %}
                {% if line.startswith('+') and not line.startswith('+++') %}
                    <div class="diff-line added">{{ line|e }}</div>
                {% elif line.startswith('-') and not line.startswith('---') %}
                    <div class="diff-line removed">{{ line|e }}</div>
                {% else %}
                    <div class="diff-line">{{ line|e }}</div>
                {% endif %}
            {% endfor %}
        </div>
    </div>
    {% endfor %}
</body>
</html>
'''

# Routes
@app.route('/entries', methods=['GET', 'POST'])
def entries():
    if request.method == 'GET':
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, title FROM entries ORDER BY last_modified_at DESC')
        entries = [{'id': row[0], 'title': row[1]} for row in cursor.fetchall()]
        conn.close()
        
        return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries)
    
    elif request.method == 'POST':
        if request.content_type != 'application/json':
            abort(400)
            
        validate_csrf_token()
        data = request.get_json()
        
        # Validate input
        if not data or not all(k in data for k in ['title', 'content', 'createdBy']):
            abort(400)
        
        # Validate string lengths to prevent abuse
        if len(data['title']) > 200 or len(data['content']) > 10000 or len(data['createdBy']) > 100:
            abort(400)
        
        entry_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Insert entry
            cursor.execute('''
                INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (entry_id, data['title'], data['content'], data['createdBy'], now, data['createdBy'], now))
            
            # Insert initial edit
            edit_id = str(uuid.uuid4())
            cursor.execute('''
                INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (edit_id, entry_id, data['content'], '', data['createdBy'], now, 'Initial creation'))
            
            conn.commit()
        except sqlite3.Error:
            conn.rollback()
            abort(500)
        finally:
            conn.close()
        
        return jsonify({
            'id': entry_id,
            'title': data['title'],
            'content': data['content'],
            'lastModifiedBy': data['createdBy'],
            'lastModifiedAt': now
        }), 201

@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    # Validate UUID format to prevent injection
    try:
        uuid.UUID(entry_id)
    except ValueError:
        abort(404)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Get entry
    cursor.execute('''
        SELECT id, title, content, last_modified_by, last_modified_at
        FROM entries WHERE id = ?
    ''', (entry_id,))
    
    row = cursor.fetchone()
    if not row:
        conn.close()
        abort(404)
    
    entry = {
        'id': row[0],
        'title': row[1],
        'content': row[2],
        'last_modified_by': row[3],
        'last_modified_at': row[4]
    }
    
    # Get contributors
    cursor.execute('''
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?
    ''', (entry_id,))
    contributors = [row[0] for row in cursor.fetchall()]
    
    conn.close()
    
    return render_template_string(ENTRY_DETAIL_TEMPLATE, entry=entry, contributors=contributors)

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    if request.content_type != 'application/json':
        abort(400)
        
    validate_csrf_token()
    
    # Validate UUID format
    try:
        uuid.UUID(entry_id)
    except ValueError:
        abort(404)
    
    data = request.get_json()
    
    # Validate input
    if not data or not all(k in data for k in ['content', 'modifiedBy', 'summary']):
        abort(400)
    
    # Validate string lengths
    if len(data['content']) > 10000 or len(data['modifiedBy']) > 100 or len(data['summary']) > 500:
        abort(400)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        # Get current entry
        cursor.execute('SELECT content, title FROM entries WHERE id = ?', (entry_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            abort(404)
        
        previous_content = row[0]
        title = row[1]
        now = datetime.utcnow().isoformat()
        
        # Update entry
        cursor.execute('''
            UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ?
            WHERE id = ?
        ''', (data['content'], data['modifiedBy'], now, entry_id))
        
        # Insert edit record
        edit_id = str(uuid.uuid4())
        cursor.execute('''
            INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (edit_id, entry_id, data['content'], previous_content, data['modifiedBy'], now, data['summary']))
        
        conn.commit()
        
        entry = {
            'id': entry_id,
            'title': title,
            'content': data['content'],
            'lastModifiedBy': data['modifiedBy'],
            'lastModifiedAt': now
        }
        
    except sqlite3.Error:
        conn.rollback()
        abort(500)
    finally:
        conn.close()
    
    return jsonify(entry)

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    # Validate UUID format
    try:
        uuid.UUID(entry_id)
    except ValueError:
        abort(404)
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Check if entry exists
    cursor.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        abort(404)
    
    title = row[0]
    
    # Get edits
    cursor.execute('''
        SELECT content, previous_content, modified_by, modified_at, summary
        FROM edits WHERE entry_id = ? ORDER BY modified_at DESC
    ''', (entry_id,))
    
    edits = []
    for row in cursor.fetchall():
        content = row[0]
        previous_content = row[1] or ''
        
        # Generate diff
        diff_lines = list(difflib.unified_diff(
            previous_content.splitlines(),
            content.splitlines(),
            lineterm='',
            fromfile='Previous',
            tofile='Current'
        ))
        
        edits.append({
            'content': content,
            'previous_content': previous_content,
            'modified_by': row[2],
            'modified_at': row[3],
            'summary': row[4],
            'diff_lines': diff_lines
        })
    
    conn.close()
    
    return render_template_string(EDIT_HISTORY_TEMPLATE, 
                                title=title, 
                                entry_id=entry_id, 
                                edits=edits)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)