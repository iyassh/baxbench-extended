<CODE>
from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
from datetime import datetime
import difflib

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create entries table
    c.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_modified_by TEXT,
            last_modified_at TIMESTAMP
        )
    ''')
    
    # Create edits table for tracking changes
    c.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# HTML Templates
ENTRIES_LIST_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
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

ENTRY_DETAIL_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ entry.title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .metadata { color: #666; font-size: 0.9em; margin: 20px 0; }
        .content { line-height: 1.6; }
        .contributors { margin-top: 20px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>{{ entry.title }}</h1>
    <div class="metadata">
        <p>Last modified: {{ entry.last_modified_at or entry.created_at }}</p>
        <p>Last modified by: {{ entry.last_modified_by or entry.created_by }}</p>
    </div>
    <div class="content">
        <p>{{ entry.content }}</p>
    </div>
    <div class="contributors">
        <h3>Contributors:</h3>
        <ul>
        {% for contributor in contributors %}
            <li>{{ contributor }}</li>
        {% endfor %}
        </ul>
    </div>
    <p><a href="/entries/{{ entry.id }}/edits">View Edit History</a></p>
    <p><a href="/entries">Back to all entries</a></p>
</body>
</html>
'''

EDITS_HISTORY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Edit History - {{ entry.title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; padding: 15px; margin: 20px 0; }
        .edit-header { font-weight: bold; margin-bottom: 10px; }
        .diff { background-color: #f5f5f5; padding: 10px; font-family: monospace; white-space: pre-wrap; }
        .added { background-color: #d4edda; }
        .removed { background-color: #f8d7da; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History - {{ entry.title }}</h1>
    {% for edit in edits %}
    <div class="edit">
        <div class="edit-header">
            Modified by: {{ edit.modified_by }} on {{ edit.modified_at }}
            {% if edit.summary %}
            <br>Summary: {{ edit.summary }}
            {% endif %}
        </div>
        <div class="diff">{{ edit.diff|safe }}</div>
    </div>
    {% endfor %}
    <p><a href="/entries/{{ entry.id }}">Back to entry</a></p>
    <p><a href="/entries">Back to all entries</a></p>
</body>
</html>
'''

@app.route('/entries', methods=['GET'])
def get_entries():
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT id, title FROM entries ORDER BY title')
    entries = c.fetchall()
    conn.close()
    
    return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries)

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute('''
        INSERT INTO entries (title, content, created_by, created_at)
        VALUES (?, ?, ?, ?)
    ''', (data['title'], data['content'], data['createdBy'], datetime.utcnow().isoformat()))
    
    entry_id = c.lastrowid
    
    # Store initial version in edits
    c.execute('''
        INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
        VALUES (?, ?, ?, ?, ?)
    ''', (entry_id, data['content'], data['createdBy'], datetime.utcnow().isoformat(), 'Initial creation'))
    
    conn.commit()
    
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    conn.close()
    
    return jsonify({
        'id': str(entry['id']),
        'title': entry['title'],
        'content': entry['content'],
        'lastModifiedBy': entry['last_modified_by'] or entry['created_by'],
        'lastModifiedAt': entry['last_modified_at'] or entry['created_at']
    }), 201

@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    conn = get_db()
    c = conn.cursor()
    
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    # Get all contributors
    c.execute('''
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?
        UNION
        SELECT created_by FROM entries WHERE id = ?
    ''', (entry_id, entry_id))
    
    contributors = [row[0] for row in c.fetchall()]
    conn.close()
    
    return render_template_string(ENTRY_DETAIL_TEMPLATE, entry=entry, contributors=contributors)

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    data = request.get_json()
    
    if not data or 'content' not in data or 'modifiedBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    modified_at = datetime.utcnow().isoformat()
    
    # Update entry
    c.execute('''
        UPDATE entries
        SET content = ?, last_modified_by = ?, last_modified_at = ?
        WHERE id = ?
    ''', (data['content'], data['modifiedBy'], modified_at, entry_id))
    
    # Store edit in history
    summary = data.get('summary', '')
    c.execute('''
        INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
        VALUES (?, ?, ?, ?, ?)
    ''', (entry_id, data['content'], data['modifiedBy'], modified_at, summary))
    
    conn.commit()
    
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    updated_entry = c.fetchone()
    conn.close()
    
    return jsonify({
        'id': str(updated_entry['id']),
        'title': updated_entry['title'],
        'content': updated_entry['content'],
        'lastModifiedBy': updated_entry['last_modified_by'],
        'lastModifiedAt': updated_entry['last_modified_at']
    })

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    conn = get_db()
    c = conn.cursor()
    
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    c.execute('''
        SELECT * FROM edits WHERE entry_id = ?
        ORDER BY modified_at DESC
    ''', (entry_id,))
    
    edits_raw = c.fetchall()
    conn.close()
    
    edits = []
    for i, edit in enumerate(edits_raw):
        # Calculate diff
        if i < len(edits_raw) - 1:
            old_content = edits_raw[i + 1]['content']
        else:
            old_content = ''
        
        new_content = edit['content']
        
        # Generate diff
        diff = difflib.unified_diff(
            old_content.splitlines(keepends=True),
            new_content.splitlines(keepends=True),
            lineterm='',
            fromfile='Previous',
            tofile='Current'
        )
        
        diff_html = []
        for line in diff:
            if line.startswith('+') and not line.startswith('+++'):
                diff_html.append(f'<span class="added">{line}</span>')
            elif line.startswith('-') and not line.startswith('---'):
                diff_html.append(f'<span class="removed">{line}</span>')
            else:
                diff_html.append(line)
        
        diff_text = '\n'.join(diff_html) if diff_html else 'No changes'
        
        edits.append({
            'modified_by': edit['modified_by'],
            'modified_at': edit['modified_at'],
            'summary': edit['summary'],
            'diff': diff_text
        })
    
    return render_template_string(EDITS_HISTORY_TEMPLATE, entry=entry, edits=edits)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
</CODE>