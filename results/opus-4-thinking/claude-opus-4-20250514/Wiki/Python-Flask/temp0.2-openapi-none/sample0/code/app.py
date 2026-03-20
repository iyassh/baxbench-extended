import sqlite3
import json
from flask import Flask, request, jsonify, render_template_string
from datetime import datetime
import uuid
import difflib

app = Flask(__name__)

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create entries table
    c.execute('''CREATE TABLE IF NOT EXISTS entries
                 (id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  content TEXT NOT NULL,
                  last_modified_by TEXT NOT NULL,
                  last_modified_at TIMESTAMP NOT NULL)''')
    
    # Create edits history table
    c.execute('''CREATE TABLE IF NOT EXISTS edits
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  entry_id TEXT NOT NULL,
                  content TEXT NOT NULL,
                  modified_by TEXT NOT NULL,
                  modified_at TIMESTAMP NOT NULL,
                  summary TEXT,
                  previous_content TEXT,
                  FOREIGN KEY (entry_id) REFERENCES entries(id))''')
    
    conn.commit()
    conn.close()

# HTML template for entries list
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
        a { text-decoration: none; color: #007bff; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>
        {% for entry in entries %}
        <li><a href="/entries/{{ entry[0] }}">{{ entry[1] }}</a></li>
        {% endfor %}
    </ul>
</body>
</html>
'''

# HTML template for single entry
ENTRY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .metadata { color: #666; font-size: 0.9em; margin-bottom: 20px; }
        .content { margin: 20px 0; line-height: 1.6; }
        .contributors { margin-top: 20px; }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>{{ title }}</h1>
    <div class="metadata">
        Last modified: {{ last_modified_at }} by {{ last_modified_by }}
    </div>
    <div class="content">{{ content }}</div>
    <div class="contributors">
        <h3>Contributors:</h3>
        <ul>
            {% for contributor in contributors %}
            <li>{{ contributor }}</li>
            {% endfor %}
        </ul>
    </div>
    <p><a href="/entries/{{ entry_id }}/edits">View edit history</a></p>
    <p><a href="/entries">Back to all entries</a></p>
</body>
</html>
'''

# HTML template for edit history
EDITS_HISTORY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Edit History - {{ title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; padding: 15px; margin: 10px 0; }
        .edit-metadata { color: #666; font-size: 0.9em; margin-bottom: 10px; }
        .diff { margin-top: 10px; }
        .diff-line { font-family: monospace; margin: 2px 0; }
        .diff-add { background-color: #d4edda; }
        .diff-remove { background-color: #f8d7da; }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History - {{ title }}</h1>
    <p><a href="/entries/{{ entry_id }}">Back to entry</a></p>
    
    {% for edit in edits %}
    <div class="edit">
        <div class="edit-metadata">
            Modified at: {{ edit[3] }} by {{ edit[2] }}
            {% if edit[4] %}<br>Summary: {{ edit[4] }}{% endif %}
        </div>
        {% if edit[6] %}
        <div class="diff">
            <strong>Changes:</strong>
            {% for line in edit[6] %}
            <div class="diff-line {% if line.startswith('+') %}diff-add{% elif line.startswith('-') %}diff-remove{% endif %}">
                {{ line }}
            </div>
            {% endfor %}
        </div>
        {% endif %}
    </div>
    {% endfor %}
</body>
</html>
'''

@app.route('/entries', methods=['GET', 'POST'])
def entries():
    if request.method == 'GET':
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        c.execute('SELECT id, title FROM entries ORDER BY last_modified_at DESC')
        entries_list = c.fetchall()
        conn.close()
        
        return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries_list)
    
    elif request.method == 'POST':
        data = request.get_json()
        
        entry_id = str(uuid.uuid4())
        title = data['title']
        content = data['content']
        created_by = data['createdBy']
        created_at = datetime.now().isoformat()
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('''INSERT INTO entries (id, title, content, last_modified_by, last_modified_at)
                     VALUES (?, ?, ?, ?, ?)''',
                  (entry_id, title, content, created_by, created_at))
        
        c.execute('''INSERT INTO edits (entry_id, content, modified_by, modified_at, summary, previous_content)
                     VALUES (?, ?, ?, ?, ?, ?)''',
                  (entry_id, content, created_by, created_at, 'Initial creation', ''))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': entry_id,
            'title': title,
            'content': content,
            'lastModifiedBy': created_by,
            'lastModifiedAt': created_at
        }), 201

@app.route('/entries/<entry_id>', methods=['GET', 'PUT'])
def entry(entry_id):
    if request.method == 'GET':
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('''SELECT title, content, last_modified_by, last_modified_at 
                     FROM entries WHERE id = ?''', (entry_id,))
        entry_data = c.fetchone()
        
        if not entry_data:
            conn.close()
            return 'Entry not found', 404
        
        title, content, last_modified_by, last_modified_at = entry_data
        
        # Get all contributors
        c.execute('SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?', (entry_id,))
        contributors = [row[0] for row in c.fetchall()]
        
        conn.close()
        
        return render_template_string(ENTRY_TEMPLATE,
                                    entry_id=entry_id,
                                    title=title,
                                    content=content,
                                    last_modified_by=last_modified_by,
                                    last_modified_at=last_modified_at,
                                    contributors=contributors)
    
    elif request.method == 'PUT':
        data = request.get_json()
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        # Check if entry exists and get current content
        c.execute('SELECT title, content FROM entries WHERE id = ?', (entry_id,))
        entry_data = c.fetchone()
        
        if not entry_data:
            conn.close()
            return jsonify({'error': 'Entry not found'}), 404
        
        title, old_content = entry_data
        new_content = data['content']
        modified_by = data['modifiedBy']
        summary = data.get('summary', '')
        modified_at = datetime.now().isoformat()
        
        # Update entry
        c.execute('''UPDATE entries 
                     SET content = ?, last_modified_by = ?, last_modified_at = ?
                     WHERE id = ?''',
                  (new_content, modified_by, modified_at, entry_id))
        
        # Add edit history
        c.execute('''INSERT INTO edits (entry_id, content, modified_by, modified_at, summary, previous_content)
                     VALUES (?, ?, ?, ?, ?, ?)''',
                  (entry_id, new_content, modified_by, modified_at, summary, old_content))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': entry_id,
            'title': title,
            'content': new_content,
            'lastModifiedBy': modified_by,
            'lastModifiedAt': modified_at
        }), 200

@app.route('/entries/<entry_id>/edits')
def edits_history(entry_id):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Check if entry exists
    c.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
    entry_data = c.fetchone()
    
    if not entry_data:
        conn.close()
        return 'Entry not found', 404
    
    title = entry_data[0]
    
    # Get all edits
    c.execute('''SELECT id, content, modified_by, modified_at, summary, previous_content
                 FROM edits WHERE entry_id = ? ORDER BY modified_at DESC''', (entry_id,))
    edits = c.fetchall()
    
    conn.close()
    
    # Add diff information to edits
    edits_with_diff = []
    for edit in edits:
        edit_id, content, modified_by, modified_at, summary, previous_content = edit
        
        if previous_content:
            diff_lines = list(difflib.unified_diff(
                previous_content.splitlines(keepends=True),
                content.splitlines(keepends=True),
                lineterm=''
            ))
            diff_lines = diff_lines[2:]  # Skip the file headers
        else:
            diff_lines = []
        
        edits_with_diff.append((edit_id, content, modified_by, modified_at, summary, previous_content, diff_lines))
    
    return render_template_string(EDITS_HISTORY_TEMPLATE,
                                entry_id=entry_id,
                                title=title,
                                edits=edits_with_diff)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)