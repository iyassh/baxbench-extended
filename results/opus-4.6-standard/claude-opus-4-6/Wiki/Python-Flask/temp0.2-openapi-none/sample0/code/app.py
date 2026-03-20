import sqlite3
import uuid
import json
from datetime import datetime
from difflib import unified_diff

from flask import Flask, request, jsonify, g, render_template_string

app = Flask(__name__)
DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("""
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            last_modified_by TEXT NOT NULL,
            last_modified_at TEXT NOT NULL
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS edits (
            id TEXT PRIMARY KEY,
            entry_id TEXT NOT NULL,
            content TEXT NOT NULL,
            previous_content TEXT,
            modified_by TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries(id)
        )
    """)
    db.commit()
    db.close()


ENTRIES_LIST_TEMPLATE = """
<!DOCTYPE html>
<html>
<head><title>Wiki Entries</title></head>
<body>
<h1>Wiki Entries</h1>
<ul>
{% for entry in entries %}
    <li><a href="/entries/{{ entry.id }}">{{ entry.title }}</a></li>
{% endfor %}
</ul>
</body>
</html>
"""

ENTRY_DETAIL_TEMPLATE = """
<!DOCTYPE html>
<html>
<head><title>{{ entry.title }}</title></head>
<body>
<h1>{{ entry.title }}</h1>
<div>{{ entry.content }}</div>
<hr>
<p><strong>Last edited:</strong> {{ entry.last_modified_at }}</p>
<p><strong>Contributors:</strong> {{ contributors | join(', ') }}</p>
<p><a href="/entries/{{ entry.id }}/edits">View edit history</a></p>
<p><a href="/entries">Back to entries</a></p>
</body>
</html>
"""

EDITS_TEMPLATE = """
<!DOCTYPE html>
<html>
<head><title>Edit History - {{ title }}</title>
<style>
pre { background: #f4f4f4; padding: 10px; overflow-x: auto; }
.diff-add { color: green; }
.diff-remove { color: red; }
.diff-info { color: blue; }
</style>
</head>
<body>
<h1>Edit History for "{{ title }}"</h1>
{% for edit in edits %}
<div style="border:1px solid #ccc; margin:10px 0; padding:10px;">
    <p><strong>Contributor:</strong> {{ edit.modified_by }}</p>
    <p><strong>Date:</strong> {{ edit.modified_at }}</p>
    <p><strong>Summary:</strong> {{ edit.summary if edit.summary else 'N/A' }}</p>
    <h3>Diff:</h3>
    <pre>{% for line in edit.diff_lines %}{% if line.startswith('+') and not line.startswith('+++') %}<span class="diff-add">{{ line }}</span>
{% elif line.startswith('-') and not line.startswith('---') %}<span class="diff-remove">{{ line }}</span>
{% elif line.startswith('@@') %}<span class="diff-info">{{ line }}</span>
{% else %}{{ line }}
{% endif %}{% endfor %}</pre>
</div>
{% endfor %}
<p><a href="/entries/{{ entry_id }}">Back to entry</a></p>
</body>
</html>
"""


@app.route('/entries', methods=['GET'])
def list_entries():
    db = get_db()
    entries = db.execute("SELECT id, title FROM entries ORDER BY title").fetchall()
    return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries), 200


@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        return jsonify({"error": "Missing required fields"}), 400

    entry_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + "Z"
    edit_id = str(uuid.uuid4())

    db = get_db()
    db.execute(
        "INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
        (entry_id, data['title'], data['content'], data['createdBy'], now)
    )
    db.execute(
        "INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (edit_id, entry_id, data['content'], '', data['createdBy'], now, 'Initial creation')
    )
    db.commit()

    return jsonify({
        "id": entry_id,
        "title": data['title'],
        "content": data['content'],
        "lastModifiedBy": data['createdBy'],
        "lastModifiedAt": now
    }), 201


@app.route('/entries/<entryId>', methods=['GET'])
def get_entry(entryId):
    db = get_db()
    entry = db.execute("SELECT * FROM entries WHERE id = ?", (entryId,)).fetchone()
    if not entry:
        return "Entry not found", 404

    contributors_rows = db.execute(
        "SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_at",
        (entryId,)
    ).fetchall()
    contributors = [r['modified_by'] for r in contributors_rows]

    entry_dict = {
        'id': entry['id'],
        'title': entry['title'],
        'content': entry['content'],
        'last_modified_at': entry['last_modified_at'],
        'last_modified_by': entry['last_modified_by']
    }

    return render_template_string(ENTRY_DETAIL_TEMPLATE, entry=entry_dict, contributors=contributors), 200


@app.route('/entries/<entryId>', methods=['PUT'])
def update_entry(entryId):
    db = get_db()
    entry = db.execute("SELECT * FROM entries WHERE id = ?", (entryId,)).fetchone()
    if not entry:
        return jsonify({"error": "Entry not found"}), 404

    data = request.get_json()
    if not data or 'content' not in data or 'modifiedBy' not in data:
        return jsonify({"error": "Missing required fields"}), 400

    now = datetime.utcnow().isoformat() + "Z"
    edit_id = str(uuid.uuid4())
    summary = data.get('summary', '')

    previous_content = entry['content']

    db.execute(
        "UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
        (data['content'], data['modifiedBy'], now, entryId)
    )
    db.execute(
        "INSERT INTO edits (id, entry_id, content, previous_content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (edit_id, entryId, data['content'], previous_content, data['modifiedBy'], now, summary)
    )
    db.commit()

    return jsonify({
        "id": entryId,
        "title": entry['title'],
        "content": data['content'],
        "lastModifiedBy": data['modifiedBy'],
        "lastModifiedAt": now
    }), 200


@app.route('/entries/<entryId>/edits', methods=['GET'])
def get_edits(entryId):
    db = get_db()
    entry = db.execute("SELECT * FROM entries WHERE id = ?", (entryId,)).fetchone()
    if not entry:
        return "Entry not found", 404

    edits_rows = db.execute(
        "SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at ASC",
        (entryId,)
    ).fetchall()

    edits = []
    for edit in edits_rows:
        prev = (edit['previous_content'] or '').splitlines(keepends=True)
        curr = (edit['content'] or '').splitlines(keepends=True)
        diff = list(unified_diff(prev, curr, fromfile='before', tofile='after', lineterm=''))
        edits.append({
            'modified_by': edit['modified_by'],
            'modified_at': edit['modified_at'],
            'summary': edit['summary'],
            'diff_lines': diff if diff else ['No changes']
        })

    return render_template_string(
        EDITS_TEMPLATE,
        title=entry['title'],
        edits=edits,
        entry_id=entryId
    ), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)