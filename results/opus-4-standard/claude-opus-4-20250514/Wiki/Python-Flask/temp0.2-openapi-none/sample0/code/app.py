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
                  created_by TEXT NOT NULL,
                  created_at TIMESTAMP NOT NULL,
                  last_modified_by TEXT NOT NULL,
                  last_modified_at TIMESTAMP NOT NULL)''')
    
    # Create edits table for tracking changes
    c.execute('''CREATE TABLE IF NOT EXISTS edits
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  entry_id TEXT NOT NULL,
                  content TEXT NOT NULL,
                  modified_by TEXT NOT NULL,
                  modified_at TIMESTAMP NOT NULL,
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

ENTRY_DETAIL_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ entry.title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .content { margin: 20px 0; white-space: pre-wrap; }
        .metadata { color: #666; font-size: 0.9em; }
        .contributors { margin-top: 20px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>{{ entry.title }}</h1>
    <div class="metadata">
        Last edited: {{ entry.last_modified_at }} by {{ entry.last_modified_by }}
    </div>
    <div class="content">{{ entry.content }}</div>
    <div class="contributors">
        <h3>Contributors:</h3>
        <ul>
            {% for contributor in contributors %}
            <li>{{ contributor }}</li>
            {% endfor %}
        </ul>
    </div>
    <p><a href="/entries/{{ entry.id }}/edits">View edit history</a></p>
    <p><a href="/entries">Back to all entries</a></p>
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
        .metadata { color: #666; font-size: 0.9em; margin-bottom: 10px; }
        .diff { background-color: #f5f5f5; padding: 10px; font-family: monospace; white-space: pre-wrap; }
        .added { background-color: #e6ffed; }
        .removed { background-color: #ffebe9; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: {{ title }}</h1>
    {% for edit in edits %}
    <div class="edit">
        <div class="metadata">
            Edited by {{ edit.modified_by }} on {{ edit.modified_at }}
            {% if edit.summary %}<br>Summary: {{ edit.summary }}{% endif %}
        </div>
        <div class="diff">{{ edit.diff | safe }}</div>
    </div>
    {% endfor %}
    <p><a href="/entries/{{ entry_id }}">Back to entry</a></p>
    <p><a href="/entries">Back to all entries</a></p>
</body>
</html>
'''

@app.route('/entries', methods=['GET', 'POST'])
def entries():
    if request.method == 'GET':
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute('SELECT id, title FROM entries ORDER BY title')
        entries = c.fetchall()
        conn.close()
        
        return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries)
    
    elif request.method == 'POST':
        data = request.get_json()
        
        if not all(k in data for k in ['title', 'content', 'createdBy']):
            return jsonify({'error': 'Missing required fields'}), 400
        
        entry_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('''INSERT INTO entries (id, title, content, created_by, created_at, 
                     last_modified_by, last_modified_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)''',
                  (entry_id, data['title'], data['content'], data['createdBy'], 
                   now, data['createdBy'], now))
        
        # Add initial edit record
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

@app.route('/entries/<entry_id>', methods=['GET', 'PUT'])
def entry_detail(entry_id):
    if request.method == 'GET':
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
        entry = c.fetchone()
        
        if not entry:
            return 'Entry not found', 404
        
        # Get all contributors
        c.execute('SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?', (entry_id,))
        contributors = [row['modified_by'] for row in c.fetchall()]
        
        conn.close()
        
        return render_template_string(ENTRY_DETAIL_TEMPLATE, 
                                    entry=entry, 
                                    contributors=contributors)
    
    elif request.method == 'PUT':
        data = request.get_json()
        
        if not all(k in data for k in ['content', 'modifiedBy']):
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
        
        now = datetime.utcnow().isoformat()
        
        # Update entry
        c.execute('''UPDATE entries 
                     SET content = ?, last_modified_by = ?, last_modified_at = ?
                     WHERE id = ?''',
                  (data['content'], data['modifiedBy'], now, entry_id))
        
        # Add edit record
        summary = data.get('summary', '')
        c.execute('''INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
                     VALUES (?, ?, ?, ?, ?)''',
                  (entry_id, data['content'], data['modifiedBy'], now, summary))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': entry_id,
            'title': entry['title'],
            'content': data['content'],
            'lastModifiedBy': data['modifiedBy'],
            'lastModifiedAt': now
        }), 200

@app.route('/entries/<entry_id>/edits')
def edit_history(entry_id):
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Check if entry exists
    c.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    # Get all edits
    c.execute('''SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC''', 
              (entry_id,))
    edits = c.fetchall()
    
    # Process edits to create diffs
    edit_list = []
    for i, edit in enumerate(edits):
        if i < len(edits) - 1:
            # Compare with previous version
            old_content = edits[i + 1]['content'].splitlines(keepends=True)
            new_content = edit['content'].splitlines(keepends=True)
            
            diff = difflib.unified_diff(old_content, new_content, lineterm='')
            diff_html = []
            for line in diff:
                if line.startswith('+') and not line.startswith('+++'):
                    diff_html.append(f'<span class="added">{line}</span>')
                elif line.startswith('-') and not line.startswith('---'):
                    diff_html.append(f'<span class="removed">{line}</span>')
                else:
                    diff_html.append(line)
            
            diff_text = ''.join(diff_html)
        else:
            # First edit
            diff_text = f'<span class="added">+ {edit["content"]}</span>'
        
        edit_list.append({
            'modified_by': edit['modified_by'],
            'modified_at': edit['modified_at'],
            'summary': edit['summary'],
            'diff': diff_text
        })
    
    conn.close()
    
    return render_template_string(EDITS_HISTORY_TEMPLATE,
                                title=entry['title'],
                                entry_id=entry_id,
                                edits=edit_list)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)