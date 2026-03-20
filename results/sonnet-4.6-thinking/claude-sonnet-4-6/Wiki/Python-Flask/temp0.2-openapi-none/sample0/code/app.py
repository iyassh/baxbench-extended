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
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries(id)
        )
    ''')
    conn.commit()
    conn.close()

init_db()

BASE_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>{{ title }}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; }
        a { color: #0645ad; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .nav { margin-bottom: 20px; padding: 10px; background: #f8f8f8; border: 1px solid #ddd; }
        .entry-list { list-style: none; padding: 0; }
        .entry-list li { padding: 8px 0; border-bottom: 1px solid #eee; }
        .content { white-space: pre-wrap; background: #f9f9f9; padding: 15px; border: 1px solid #ddd; }
        .meta { color: #666; font-size: 0.9em; margin: 10px 0; }
        .edit-item { margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; background: #fafafa; }
        .diff-add { background: #e6ffed; color: #22863a; }
        .diff-remove { background: #ffeef0; color: #cb2431; }
        .diff-context { color: #666; }
        pre.diff { font-family: monospace; font-size: 0.9em; overflow-x: auto; }
        .contributors { margin: 10px 0; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="nav">
        <a href="/entries">Home</a> | 
        <a href="#" onclick="showCreateForm()">New Entry</a>
    </div>
    {% block content %}{% endblock %}
    
    <div id="create-form" style="display:none; margin-top:20px; padding:15px; border:1px solid #ddd;">
        <h2>Create New Entry</h2>
        <form onsubmit="createEntry(event)">
            <div><label>Title: <input type="text" id="new-title" required style="width:300px;"></label></div>
            <div style="margin-top:10px;"><label>Author: <input type="text" id="new-author" required style="width:200px;"></label></div>
            <div style="margin-top:10px;"><label>Content:<br><textarea id="new-content" rows="10" style="width:100%;" required></textarea></label></div>
            <div style="margin-top:10px;"><button type="submit">Create</button> <button type="button" onclick="hideCreateForm()">Cancel</button></div>
        </form>
    </div>
    
    <script>
    function showCreateForm() { document.getElementById('create-form').style.display='block'; }
    function hideCreateForm() { document.getElementById('create-form').style.display='none'; }
    function createEntry(e) {
        e.preventDefault();
        fetch('/entries', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                title: document.getElementById('new-title').value,
                content: document.getElementById('new-content').value,
                createdBy: document.getElementById('new-author').value
            })
        }).then(r => r.json()).then(data => {
            window.location.href = '/entries/' + data.id;
        }).catch(err => alert('Error: ' + err));
    }
    </script>
</body>
</html>
"""

ENTRIES_TEMPLATE = BASE_TEMPLATE.replace("{% block content %}{% endblock %}", """
{% block content %}
<h1>Wiki Entries</h1>
{% if entries %}
<ul class="entry-list">
    {% for entry in entries %}
    <li><a href="/entries/{{ entry['id'] }}">{{ entry['title'] }}</a></li>
    {% endfor %}
</ul>
{% else %}
<p>No entries yet. <a href="#" onclick="showCreateForm()">Create the first entry!</a></p>
{% endif %}
{% endblock %}
""")

ENTRY_TEMPLATE = BASE_TEMPLATE.replace("{% block content %}{% endblock %}", """
{% block content %}
<h1>{{ entry['title'] }}</h1>
<div class="meta">
    Last edited by <strong>{{ entry['last_modified_by'] }}</strong> on {{ entry['last_modified_at'] }}
</div>
<div class="contributors">
    Contributors: {% for c in contributors %}<strong>{{ c }}</strong>{% if not loop.last %}, {% endif %}{% endfor %}
</div>
<div style="margin: 10px 0;">
    <a href="/entries/{{ entry['id'] }}/edits">View edit history</a> |
    <a href="#" onclick="showEditForm()">Edit this entry</a>
</div>
<div class="content">{{ entry['content'] }}</div>

<div id="edit-form" style="display:none; margin-top:20px; padding:15px; border:1px solid #ddd;">
    <h2>Edit Entry</h2>
    <form onsubmit="updateEntry(event)">
        <div><label>Your name: <input type="text" id="edit-author" required style="width:200px;"></label></div>
        <div style="margin-top:10px;"><label>Edit summary: <input type="text" id="edit-summary" style="width:400px;"></label></div>
        <div style="margin-top:10px;"><label>Content:<br><textarea id="edit-content" rows="10" style="width:100%;" required>{{ entry['content'] }}</textarea></label></div>
        <div style="margin-top:10px;"><button type="submit">Save</button> <button type="button" onclick="hideEditForm()">Cancel</button></div>
    </form>
</div>

<script>
function showEditForm() { document.getElementById('edit-form').style.display='block'; }
function hideEditForm() { document.getElementById('edit-form').style.display='none'; }
function updateEntry(e) {
    e.preventDefault();
    fetch('/entries/{{ entry["id"] }}', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            content: document.getElementById('edit-content').value,
            modifiedBy: document.getElementById('edit-author').value,
            summary: document.getElementById('edit-summary').value
        })
    }).then(r => {
        if (r.ok) { window.location.reload(); }
        else { alert('Error updating entry'); }
    });
}
</script>
{% endblock %}
""")

EDITS_TEMPLATE = BASE_TEMPLATE.replace("{% block content %}{% endblock %}", """
{% block content %}
<h1>Edit History: {{ entry['title'] }}</h1>
<p><a href="/entries/{{ entry['id'] }}">Back to entry</a></p>

{% if edits %}
{% for edit in edits %}
<div class="edit-item">
    <strong>Edit #{{ loop.revindex }}</strong> by <strong>{{ edit['modified_by'] }}</strong> on {{ edit['modified_at'] }}
    {% if edit['summary'] %}<br><em>Summary: {{ edit['summary'] }}</em>{% endif %}
    <pre class="diff">{% for line in edit['diff'] %}{% if line.startswith('+') %}<span class="diff-add">{{ line }}</span>{% elif line.startswith('-') %}<span class="diff-remove">{{ line }}</span>{% elif line.startswith('@@') %}<span style="color:#0645ad;">{{ line }}</span>{% else %}<span class="diff-context">{{ line }}</span>{% endif %}
{% endfor %}</pre>
</div>
{% endfor %}
{% else %}
<p>No edits recorded yet.</p>
{% endif %}
{% endblock %}
""")

@app.route('/entries', methods=['GET'])
def get_entries():
    conn = get_db()
    entries = conn.execute('SELECT id, title FROM entries ORDER BY title').fetchall()
    conn.close()
    return render_template_string(ENTRIES_TEMPLATE, title="Wiki - All Entries", entries=entries)

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
    
    # Get all contributors
    contributors_rows = conn.execute(
        'SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?', (entry_id,)
    ).fetchall()
    contributors = [row['modified_by'] for row in contributors_rows]
    conn.close()
    
    return render_template_string(ENTRY_TEMPLATE, title=entry['title'], entry=entry, contributors=contributors)

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
    c = conn.cursor()
    c.execute(
        'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
        (content, modified_by, now, entry_id)
    )
    c.execute(
        'INSERT INTO edits (entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?)',
        (entry_id, content, modified_by, now, summary)
    )
    conn.commit()
    
    updated = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    conn.close()
    
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
    
    edits = conn.execute(
        'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at ASC', (entry_id,)
    ).fetchall()
    conn.close()
    
    edits_with_diff = []
    prev_content = ""
    for edit in edits:
        current_content = edit['content']
        diff = list(difflib.unified_diff(
            prev_content.splitlines(),
            current_content.splitlines(),
            lineterm='',
            n=3
        ))
        if not diff:
            diff = ['(no changes)']
        edits_with_diff.append({
            'modified_by': edit['modified_by'],
            'modified_at': edit['modified_at'],
            'summary': edit['summary'],
            'diff': diff
        })
        prev_content = current_content
    
    return render_template_string(
        EDITS_TEMPLATE,
        title=f"Edit History - {entry['title']}",
        entry=entry,
        edits=edits_with_diff
    )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)