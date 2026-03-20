from flask import Flask, request, jsonify, render_template_string, abort
import sqlite3
import json
from datetime import datetime
import uuid
import difflib
import html

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create entries table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            current_content TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            last_modified_by TEXT NOT NULL,
            last_modified_at TIMESTAMP NOT NULL
        )
    ''')
    
    # Create edits table for tracking history
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id TEXT NOT NULL,
            content TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            modified_at TIMESTAMP NOT NULL,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries(id)
        )
    ''')
    
    conn.commit()
    conn.close()

# HTML templates
ENTRIES_LIST_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 10px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>
    {% for entry in entries %}
        <li><a href="/entries/{{ entry.id }}">{{ entry.title }}</a></li>
    {% endfor %}
    </ul>
</body>
</html>
'''

ENTRY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ entry.title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .content { margin: 20px 0; line-height: 1.6; white-space: pre-wrap; }
        .metadata { color: #666; font-size: 0.9em; margin: 20px 0; }
        .contributors { margin-top: 20px; }
        .links { margin-top: 20px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>{{ entry.title }}</h1>
    <div class="content">{{ entry.content }}</div>
    <div class="metadata">
        Last edited: {{ entry.last_modified_at }} by {{ entry.last_modified_by }}
    </div>
    <div class="contributors">
        <strong>Contributors:</strong>
        <ul>
        {% for contributor in contributors %}
            <li>{{ contributor }}</li>
        {% endfor %}
        </ul>
    </div>
    <div class="links">
        <a href="/entries/{{ entry.id }}/edits">View edit history</a> | 
        <a href="/entries">Back to entries list</a>
    </div>
</body>
</html>
'''

EDITS_HISTORY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Edit History - {{ title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; }
        .edit-header { background: #f5f5f5; margin: -15px -15px 10px -15px; padding: 10px 15px; }
        .diff { font-family: monospace; white-space: pre-wrap; background: #f9f9f9; padding: 10px; overflow-x: auto; }
        .added { background: #e6ffe6; }
        .removed { background: #ffe6e6; }
        .links { margin-top: 20px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: {{ title }}</h1>
    {% for edit in edits %}
    <div class="edit">
        <div class="edit-header">
            <strong>{{ edit.modified_at }}</strong> by {{ edit.modified_by }}
            {% if edit.summary %}
            <br>Summary: {{ edit.summary }}
            {% endif %}
        </div>
        <div class="diff">{{ edit.diff|safe }}</div>
    </div>
    {% endfor %}
    <div class="links">
        <a href="/entries/{{ entry_id }}">Back to entry</a> | 
        <a href="/entries">Back to entries list</a>
    </div>
</body>
</html>
'''

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def sanitize_input(text):
    """Basic input sanitization"""
    if text is None:
        return None
    return str(text).strip()

@app.route('/entries', methods=['GET'])
def get_entries():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, title FROM entries ORDER BY title')
    entries = cursor.fetchall()
    conn.close()
    
    return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries)

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        abort(400)
    
    entry_id = str(uuid.uuid4())
    title = sanitize_input(data['title'])
    content = sanitize_input(data['content'])
    created_by = sanitize_input(data['createdBy'])
    
    if not title or not content or not created_by:
        abort(400)
    
    created_at = datetime.utcnow().isoformat()
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Insert entry
        cursor.execute('''
            INSERT INTO entries (id, title, current_content, created_by, created_at, last_modified_by, last_modified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (entry_id, title, content, created_by, created_at, created_by, created_at))
        
        # Add initial edit record
        cursor.execute('''
            INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, content, created_by, created_at, 'Initial creation'))
        
        conn.commit()
        
        response = {
            'id': entry_id,
            'title': title,
            'content': content,
            'lastModifiedBy': created_by,
            'lastModifiedAt': created_at
        }
        
        return jsonify(response), 201
    
    except Exception as e:
        conn.rollback()
        abort(500)
    finally:
        conn.close()

@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    entry_id = sanitize_input(entry_id)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get entry
    cursor.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = cursor.fetchone()
    
    if not entry:
        conn.close()
        abort(404)
    
    # Get contributors
    cursor.execute('''
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?
        ORDER BY modified_by
    ''', (entry_id,))
    contributors = [row[0] for row in cursor.fetchall()]
    
    conn.close()
    
    entry_dict = {
        'id': entry['id'],
        'title': html.escape(entry['title']),
        'content': html.escape(entry['current_content']),
        'last_modified_by': html.escape(entry['last_modified_by']),
        'last_modified_at': entry['last_modified_at']
    }
    
    contributors = [html.escape(c) for c in contributors]
    
    return render_template_string(ENTRY_TEMPLATE, entry=entry_dict, contributors=contributors)

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    entry_id = sanitize_input(entry_id)
    data = request.get_json()
    
    if not data or 'content' not in data or 'modifiedBy' not in data:
        abort(400)
    
    content = sanitize_input(data['content'])
    modified_by = sanitize_input(data['modifiedBy'])
    summary = sanitize_input(data.get('summary', ''))
    
    if not content or not modified_by:
        abort(400)
    
    modified_at = datetime.utcnow().isoformat()
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if entry exists
    cursor.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = cursor.fetchone()
    
    if not entry:
        conn.close()
        abort(404)
    
    try:
        # Update entry
        cursor.execute('''
            UPDATE entries
            SET current_content = ?, last_modified_by = ?, last_modified_at = ?
            WHERE id = ?
        ''', (content, modified_by, modified_at, entry_id))
        
        # Add edit record
        cursor.execute('''
            INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, content, modified_by, modified_at, summary))
        
        conn.commit()
        
        response = {
            'id': entry_id,
            'title': entry['title'],
            'content': content,
            'lastModifiedBy': modified_by,
            'lastModifiedAt': modified_at
        }
        
        return jsonify(response), 200
    
    except Exception as e:
        conn.rollback()
        abort(500)
    finally:
        conn.close()

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    entry_id = sanitize_input(entry_id)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if entry exists
    cursor.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
    entry = cursor.fetchone()
    
    if not entry:
        conn.close()
        abort(404)
    
    title = html.escape(entry['title'])
    
    # Get all edits ordered by time
    cursor.execute('''
        SELECT content, modified_by, modified_at, summary
        FROM edits
        WHERE entry_id = ?
        ORDER BY modified_at DESC
    ''', (entry_id,))
    
    edits = cursor.fetchall()
    conn.close()
    
    # Process edits to generate diffs
    processed_edits = []
    for i in range(len(edits)):
        current_content = edits[i]['content'].splitlines()
        
        if i < len(edits) - 1:
            previous_content = edits[i + 1]['content'].splitlines()
        else:
            previous_content = []
        
        # Generate diff
        differ = difflib.unified_diff(
            previous_content, 
            current_content,
            lineterm='',
            n=3
        )
        
        diff_html = []
        for line in differ:
            escaped_line = html.escape(line)
            if line.startswith('+') and not line.startswith('+++'):
                diff_html.append(f'<span class="added">{escaped_line}</span>')
            elif line.startswith('-') and not line.startswith('---'):
                diff_html.append(f'<span class="removed">{escaped_line}</span>')
            else:
                diff_html.append(escaped_line)
        
        processed_edits.append({
            'modified_by': html.escape(edits[i]['modified_by']),
            'modified_at': edits[i]['modified_at'],
            'summary': html.escape(edits[i]['summary']) if edits[i]['summary'] else '',
            'diff': '\n'.join(diff_html) if diff_html else 'No changes'
        })
    
    return render_template_string(
        EDITS_HISTORY_TEMPLATE, 
        title=title, 
        edits=processed_edits,
        entry_id=entry_id
    )

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)