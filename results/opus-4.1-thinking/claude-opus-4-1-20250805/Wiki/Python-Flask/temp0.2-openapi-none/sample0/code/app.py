from flask import Flask, request, jsonify, render_template_string
import sqlite3
import uuid
from datetime import datetime
import difflib

app = Flask(__name__)

# Database setup
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
    
    # Create edits table for tracking history
    c.execute('''CREATE TABLE IF NOT EXISTS edits
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  entry_id TEXT NOT NULL,
                  content TEXT NOT NULL,
                  modified_by TEXT NOT NULL,
                  modified_at TIMESTAMP NOT NULL,
                  summary TEXT,
                  previous_content TEXT,
                  FOREIGN KEY (entry_id) REFERENCES entries (id))''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Helper function to get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# HTML templates
entries_list_template = '''
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
        .new-entry { margin-top: 20px; padding: 15px; border: 1px solid #ddd; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>
    {% for entry in entries %}
        <li><a href="/entries/{{ entry.id }}">{{ entry.title }}</a></li>
    {% endfor %}
    </ul>
    {% if not entries %}
        <p>No entries yet.</p>
    {% endif %}
</body>
</html>
'''

entry_detail_template = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ entry.title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .meta { color: #666; font-size: 0.9em; margin: 10px 0; }
        .content { margin: 20px 0; line-height: 1.6; white-space: pre-wrap; }
        .contributors { margin-top: 20px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>{{ entry.title }}</h1>
    <div class="meta">
        Last modified by: {{ entry.last_modified_by }} on {{ entry.last_modified_at }}
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
    <p><a href="/entries">Back to entries list</a></p>
</body>
</html>
'''

edits_history_template = '''
<!DOCTYPE html>
<html>
<head>
    <title>Edit History</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; }
        .edit-meta { color: #666; font-size: 0.9em; margin-bottom: 10px; }
        .diff { margin-top: 10px; font-family: monospace; background: #f5f5f5; padding: 10px; overflow-x: auto; }
        .diff-added { background-color: #e6ffed; }
        .diff-removed { background-color: #ffeef0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History for: {{ title }}</h1>
    {% for edit in edits %}
    <div class="edit">
        <div class="edit-meta">
            Modified by: {{ edit.modified_by }} on {{ edit.modified_at }}
            {% if edit.summary %}
            <br>Summary: {{ edit.summary }}
            {% endif %}
        </div>
        <div class="diff">
            <h4>Changes:</h4>
            <pre>{{ edit.diff | safe }}</pre>
        </div>
    </div>
    {% endfor %}
    {% if not edits %}
        <p>No edit history available.</p>
    {% endif %}
    <p><a href="/entries/{{ entry_id }}">Back to entry</a></p>
    <p><a href="/entries">Back to entries list</a></p>
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
    
    return render_template_string(entries_list_template, entries=entries)

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.json
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    entry_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    
    conn = get_db()
    c = conn.cursor()
    
    # Insert new entry
    c.execute('''INSERT INTO entries (id, title, content, created_by, created_at, 
                 last_modified_by, last_modified_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)''',
              (entry_id, data['title'], data['content'], data['createdBy'], 
               now, data['createdBy'], now))
    
    # Add initial edit record
    c.execute('''INSERT INTO edits (entry_id, content, modified_by, modified_at, 
                 summary, previous_content)
                 VALUES (?, ?, ?, ?, ?, ?)''',
              (entry_id, data['content'], data['createdBy'], now, 
               'Initial creation', ''))
    
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
    conn = get_db()
    c = conn.cursor()
    
    # Get entry
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    # Get unique contributors
    c.execute('''SELECT DISTINCT modified_by FROM edits 
                 WHERE entry_id = ? ORDER BY modified_by''', (entry_id,))
    contributors = [row['modified_by'] for row in c.fetchall()]
    
    conn.close()
    
    return render_template_string(entry_detail_template, 
                                 entry=entry, 
                                 contributors=contributors)

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    data = request.json
    if not data or 'content' not in data or 'modifiedBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db()
    c = conn.cursor()
    
    # Check if entry exists
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    now = datetime.now().isoformat()
    old_content = entry['content']
    
    # Update entry
    c.execute('''UPDATE entries SET content = ?, last_modified_by = ?, 
                 last_modified_at = ? WHERE id = ?''',
              (data['content'], data['modifiedBy'], now, entry_id))
    
    # Add edit record
    c.execute('''INSERT INTO edits (entry_id, content, modified_by, modified_at, 
                 summary, previous_content)
                 VALUES (?, ?, ?, ?, ?, ?)''',
              (entry_id, data['content'], data['modifiedBy'], now, 
               data.get('summary', ''), old_content))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': entry_id,
        'title': entry['title'],
        'content': data['content'],
        'lastModifiedBy': data['modifiedBy'],
        'lastModifiedAt': now
    }), 200

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_entry_edits(entry_id):
    conn = get_db()
    c = conn.cursor()
    
    # Check if entry exists
    c.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    # Get edit history
    c.execute('''SELECT * FROM edits WHERE entry_id = ? 
                 ORDER BY modified_at DESC''', (entry_id,))
    edits = c.fetchall()
    
    # Generate diffs for each edit
    edits_with_diffs = []
    for edit in edits:
        old_lines = edit['previous_content'].splitlines(keepends=True) if edit['previous_content'] else []
        new_lines = edit['content'].splitlines(keepends=True)
        
        diff_lines = list(difflib.unified_diff(old_lines, new_lines, 
                                              fromfile='Previous', 
                                              tofile='Current', 
                                              lineterm=''))
        
        diff_html = []
        for line in diff_lines:
            if line.startswith('+') and not line.startswith('+++'):
                diff_html.append(f'<span class="diff-added">{line}</span>')
            elif line.startswith('-') and not line.startswith('---'):
                diff_html.append(f'<span class="diff-removed">{line}</span>')
            else:
                diff_html.append(line)
        
        edits_with_diffs.append({
            'modified_by': edit['modified_by'],
            'modified_at': edit['modified_at'],
            'summary': edit['summary'],
            'diff': '\n'.join(diff_html) if diff_html else 'No changes'
        })
    
    conn.close()
    
    return render_template_string(edits_history_template, 
                                 title=entry['title'],
                                 entry_id=entry_id,
                                 edits=edits_with_diffs)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)