from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
from datetime import datetime
import difflib
import uuid

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create entries table
    c.execute('''CREATE TABLE IF NOT EXISTS entries
                 (id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  content TEXT NOT NULL,
                  last_modified_by TEXT NOT NULL,
                  last_modified_at TEXT NOT NULL)''')
    
    # Create edits history table
    c.execute('''CREATE TABLE IF NOT EXISTS edits
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  entry_id TEXT NOT NULL,
                  content TEXT NOT NULL,
                  modified_by TEXT NOT NULL,
                  modified_at TEXT NOT NULL,
                  summary TEXT,
                  FOREIGN KEY (entry_id) REFERENCES entries (id))''')
    
    conn.commit()
    conn.close()

# HTML templates
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
        .content { margin: 20px 0; padding: 20px; background-color: #f5f5f5; border-radius: 5px; }
        .metadata { color: #666; font-size: 0.9em; margin: 10px 0; }
        .contributors { margin: 20px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>{{ entry.title }}</h1>
    <div class="metadata">
        Last edited: {{ entry.last_modified_at }} by {{ entry.last_modified_by }}
    </div>
    <div class="content">
        {{ entry.content }}
    </div>
    <div class="contributors">
        <h3>Contributors:</h3>
        <ul>
            {% for contributor in contributors %}
            <li>{{ contributor }}</li>
            {% endfor %}
        </ul>
    </div>
    <p><a href="/entries/{{ entry.id }}/edits">View edit history</a></p>
</body>
</html>
'''

EDITS_HISTORY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Edit History</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .edit { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .metadata { color: #666; font-size: 0.9em; margin-bottom: 10px; }
        .diff { background-color: #f5f5f5; padding: 10px; border-radius: 3px; font-family: monospace; white-space: pre-wrap; }
        .added { background-color: #d4f4dd; }
        .removed { background-color: #fdd4d4; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History for "{{ title }}"</h1>
    <p><a href="/entries/{{ entry_id }}">Back to entry</a></p>
    {% for edit in edits %}
    <div class="edit">
        <div class="metadata">
            Edited by {{ edit.modified_by }} on {{ edit.modified_at }}
            {% if edit.summary %}
            <br>Summary: {{ edit.summary }}
            {% endif %}
        </div>
        <div class="diff">{{ edit.diff | safe }}</div>
    </div>
    {% endfor %}
</body>
</html>
'''

@app.route('/entries', methods=['GET'])
def get_entries():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT id, title FROM entries ORDER BY title')
    entries = [dict(row) for row in c.fetchall()]
    conn.close()
    
    return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries)

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.json
    
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    entry_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create the entry
    c.execute('''INSERT INTO entries (id, title, content, last_modified_by, last_modified_at)
                 VALUES (?, ?, ?, ?, ?)''',
              (entry_id, data['title'], data['content'], data['createdBy'], now))
    
    # Add to edit history
    c.execute('''INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
                 VALUES (?, ?, ?, ?, ?)''',
              (entry_id, data['content'], data['createdBy'], now, 'Initial creation'))
    
    conn.commit()
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
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Get the entry
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    # Get unique contributors
    c.execute('SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?', (entry_id,))
    contributors = [row['modified_by'] for row in c.fetchall()]
    
    conn.close()
    
    entry_dict = dict(entry)
    
    return render_template_string(ENTRY_DETAIL_TEMPLATE, 
                                 entry=entry_dict, 
                                 contributors=contributors)

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    data = request.json
    
    if not data or 'content' not in data or 'modifiedBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Check if entry exists
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    now = datetime.now().isoformat()
    
    # Update the entry
    c.execute('''UPDATE entries 
                 SET content = ?, last_modified_by = ?, last_modified_at = ?
                 WHERE id = ?''',
              (data['content'], data['modifiedBy'], now, entry_id))
    
    # Add to edit history
    summary = data.get('summary', 'No summary provided')
    c.execute('''INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
                 VALUES (?, ?, ?, ?, ?)''',
              (entry_id, data['content'], data['modifiedBy'], now, summary))
    
    conn.commit()
    
    # Get updated entry
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    updated_entry = dict(c.fetchone())
    
    conn.close()
    
    return jsonify({
        'id': updated_entry['id'],
        'title': updated_entry['title'],
        'content': updated_entry['content'],
        'lastModifiedBy': updated_entry['last_modified_by'],
        'lastModifiedAt': updated_entry['last_modified_at']
    }), 200

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Check if entry exists
    c.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    title = entry['title']
    
    # Get all edits
    c.execute('''SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC''', 
              (entry_id,))
    edits = c.fetchall()
    
    conn.close()
    
    # Process edits and create diffs
    edits_with_diff = []
    previous_content = ""
    
    for i in range(len(edits) - 1, -1, -1):
        edit = dict(edits[i])
        current_content = edit['content']
        
        # Create diff
        diff_lines = difflib.unified_diff(
            previous_content.splitlines(keepends=True),
            current_content.splitlines(keepends=True),
            lineterm='',
            n=3
        )
        
        diff_html = ""
        for line in diff_lines:
            if line.startswith('+') and not line.startswith('+++'):
                diff_html += f'<span class="added">{line}</span>'
            elif line.startswith('-') and not line.startswith('---'):
                diff_html += f'<span class="removed">{line}</span>'
            else:
                diff_html += line
        
        if not diff_html:
            diff_html = "No changes in content"
        
        edit['diff'] = diff_html
        edits_with_diff.insert(0, edit)
        previous_content = current_content
    
    return render_template_string(EDITS_HISTORY_TEMPLATE, 
                                 edits=edits_with_diff,
                                 title=title,
                                 entry_id=entry_id)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)