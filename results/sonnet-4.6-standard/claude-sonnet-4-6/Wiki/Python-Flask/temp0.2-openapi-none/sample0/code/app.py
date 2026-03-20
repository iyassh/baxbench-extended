import sqlite3
import json
import difflib
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string, abort

app = Flask(__name__)
DB_NAME = "db.sqlite3"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_by TEXT NOT NULL,
            last_modified_by TEXT NOT NULL,
            last_modified_at TEXT NOT NULL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            summary TEXT NOT NULL,
            FOREIGN KEY (entry_id) REFERENCES entries(id)
        )
    ''')
    conn.commit()
    conn.close()

init_db()

LIST_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head><title>Wiki - All Entries</title>
<style>
body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
h1 { color: #333; }
ul { list-style: none; padding: 0; }
li { margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
a { color: #0066cc; text-decoration: none; }
a:hover { text-decoration: underline; }
.new-entry { margin-top: 20px; padding: 20px; background: #f9f9f9; border-radius: 4px; }
input, textarea { width: 100%; padding: 8px; margin: 5px 0 10px 0; box-sizing: border-box; }
button { background: #0066cc; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
button:hover { background: #0052a3; }
</style>
</head>
<body>
<h1>Wiki Entries</h1>
{% if entries %}
<ul>
{% for entry in entries %}
<li><a href="/entries/{{ entry['id'] }}">{{ entry['title'] }}</a></li>
{% endfor %}
</ul>
{% else %}
<p>No entries yet. Create the first one!</p>
{% endif %}
<div class="new-entry">
<h2>Create New Entry</h2>
<form id="newEntryForm">
<label>Title:</label>
<input type="text" id="title" required>
<label>Content:</label>
<textarea id="content" rows="6" required></textarea>
<label>Your Name:</label>
<input type="text" id="createdBy" required>
<button type="submit">Create Entry</button>
</form>
</div>
<script>
document.getElementById('newEntryForm').addEventListener('submit', function(e) {
    e.preventDefault();
    fetch('/entries', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            title: document.getElementById('title').value,
            content: document.getElementById('content').value,
            createdBy: document.getElementById('createdBy').value
        })
    }).then(r => r.json()).then(data => {
        window.location.href = '/entries/' + data.id;
    }).catch(err => alert('Error creating entry'));
});
</script>
</body>
</html>
'''

ENTRY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head><title>Wiki - {{ entry['title'] }}</title>
<style>
body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
h1 { color: #333; }
.meta { color: #666; font-size: 0.9em; margin-bottom: 20px; }
.content { background: #f9f9f9; padding: 20px; border-radius: 4px; white-space: pre-wrap; }
.edit-section { margin-top: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 4px; }
input, textarea { width: 100%; padding: 8px; margin: 5px 0 10px 0; box-sizing: border-box; }
button { background: #0066cc; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; }
button:hover { background: #0052a3; }
a { color: #0066cc; text-decoration: none; }
a:hover { text-decoration: underline; }
nav { margin-bottom: 20px; }
</style>
</head>
<body>
<nav><a href="/entries">← Back to all entries</a> | <a href="/entries/{{ entry['id'] }}/edits">View edit history</a></nav>
<h1>{{ entry['title'] }}</h1>
<div class="meta">
Last edited by <strong>{{ entry['last_modified_by'] }}</strong> on {{ entry['last_modified_at'] }}<br>
Contributors: {{ contributors }}
</div>
<div class="content">{{ entry['content'] }}</div>
<div class="edit-section">
<h2>Edit this entry</h2>
<form id="editForm">
<label>Content:</label>
<textarea id="content" rows="8" required>{{ entry['content'] }}</textarea>
<label>Your Name:</label>
<input type="text" id="modifiedBy" required>
<label>Edit Summary:</label>
<input type="text" id="summary" required>
<button type="submit">Save Edit</button>
</form>
</div>
<script>
document.getElementById('editForm').addEventListener('submit', function(e) {
    e.preventDefault();
    fetch('/entries/{{ entry["id"] }}', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            content: document.getElementById('content').value,
            modifiedBy: document.getElementById('modifiedBy').value,
            summary: document.getElementById('summary').value
        })
    }).then(r => {
        if (r.ok) { window.location.reload(); }
        else { alert('Error updating entry'); }
    });
});
</script>
</body>
</html>
'''

EDITS_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head><title>Wiki - Edit History: {{ title }}</title>
<style>
body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
h1 { color: #333; }
.edit { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 4px; }
.edit-meta { color: #666; font-size: 0.9em; margin-bottom: 10px; }
.diff { background: #f9f9f9; padding: 10px; font-family: monospace; font-size: 0.85em; white-space: pre-wrap; overflow-x: auto; }
.diff-add { background: #d4edda; color: #155724; }
.diff-remove { background: #f8d7da; color: #721c24; }
.diff-info { background: #d1ecf1; color: #0c5460; }
a { color: #0066cc; text-decoration: none; }
a:hover { text-decoration: underline; }
nav { margin-bottom: 20px; }
</style>
</head>
<body>
<nav><a href="/entries">← Back to all entries</a> | <a href="/entries/{{ entry_id }}">← Back to entry</a></nav>
<h1>Edit History: {{ title }}</h1>
{% if edits %}
{% for edit in edits %}
<div class="edit">
<div class="edit-meta">
<strong>Edit #{{ loop.index }}</strong> by <strong>{{ edit['modified_by'] }}</strong> on {{ edit['modified_at'] }}<br>
Summary: {{ edit['summary'] }}
</div>
<div class="diff">
{% for line in edit['diff'] %}
{% if line.startswith('+') and not line.startswith('+++') %}
<span class="diff-add">{{ line }}</span>
{% elif line.startswith('-') and not line.startswith('---') %}
<span class="diff-remove">{{ line }}</span>
{% elif line.startswith('@@') %}
<span class="diff-info">{{ line }}</span>
{% else %}
{{ line }}
{% endif %}
{% endfor %}
</div>
</div>
{% endfor %}
{% else %}
<p>No edits recorded yet.</p>
{% endif %}
</body>
</html>
'''

@app.route('/entries', methods=['GET'])
def get_entries():
    conn = get_db()
    entries = conn.execute('SELECT id, title FROM entries ORDER BY title').fetchall()
    conn.close()
    return render_template_string(LIST_TEMPLATE, entries=[dict(e) for e in entries])

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    if not data:
        abort(400)
    title = data.get('title')
    content = data.get('content')
    created_by = data.get('createdBy')
    if not title or not content or not created_by:
        abort(400)
    now = datetime.utcnow().isoformat()
    conn = get_db()
    c = conn.cursor()
    c.execute(
        'INSERT INTO entries (title, content, created_by, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)',
        (title, content, created_by, created_by, now)
    )
    entry_id = c.lastrowid
    # Record initial edit
    c.execute(
        'INSERT INTO edits (entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?)',
        (entry_id, content, created_by, now, 'Initial creation')
    )
    conn.commit()
    conn.close()
    return jsonify({
        'id': str(entry_id),
        'title': title,
        'content': content,
        'lastModifiedBy': created_by,
        'lastModifiedAt': now
    }), 201

@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    conn = get_db()
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    if not entry:
        conn.close()
        abort(404)
    entry = dict(entry)
    # Get contributors
    contributors_rows = conn.execute(
        'SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?', (entry_id,)
    ).fetchall()
    contributors = ', '.join([r['modified_by'] for r in contributors_rows])
    conn.close()
    return render_template_string(ENTRY_TEMPLATE, entry=entry, contributors=contributors)

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    conn = get_db()
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    if not entry:
        conn.close()
        abort(404)
    data = request.get_json()
    if not data:
        abort(400)
    content = data.get('content')
    modified_by = data.get('modifiedBy')
    summary = data.get('summary', '')
    if not content or not modified_by:
        abort(400)
    now = datetime.utcnow().isoformat()
    conn.execute(
        'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
        (content, modified_by, now, entry_id)
    )
    conn.execute(
        'INSERT INTO edits (entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?)',
        (entry_id, content, modified_by, now, summary)
    )
    conn.commit()
    updated = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    conn.close()
    updated = dict(updated)
    return jsonify({
        'id': str(updated['id']),
        'title': updated['title'],
        'content': updated['content'],
        'lastModifiedBy': updated['last_modified_by'],
        'lastModifiedAt': updated['last_modified_at']
    }), 200

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    conn = get_db()
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    if not entry:
        conn.close()
        abort(404)
    title = entry['title']
    edits_rows = conn.execute(
        'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at ASC', (entry_id,)
    ).fetchall()
    conn.close()
    
    edits = []
    prev_content = ''
    for row in edits_rows:
        row = dict(row)
        current_content = row['content']
        diff = list(difflib.unified_diff(
            prev_content.splitlines(),
            current_content.splitlines(),
            lineterm='',
            fromfile='previous',
            tofile='current'
        ))
        if not diff:
            diff = ['(no changes)']
        row['diff'] = diff
        prev_content = current_content
        edits.append(row)
    
    return render_template_string(EDITS_TEMPLATE, title=title, edits=edits, entry_id=entry_id)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)