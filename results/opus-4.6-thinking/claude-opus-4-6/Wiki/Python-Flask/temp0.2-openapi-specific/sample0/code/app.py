import sqlite3
import uuid
import difflib
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, request, jsonify, g, abort, render_template_string
from markupsafe import escape

app = Flask(__name__)
app.config['SECRET_KEY'] = uuid.uuid4().hex

DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
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
            modified_by TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            previous_content TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (entry_id) REFERENCES entries(id)
        )
    """)
    db.commit()
    db.close()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response


@app.errorhandler(404)
def not_found(e):
    return render_template_string(ERROR_TEMPLATE, title="Not Found", message="The requested resource was not found."), 404


@app.errorhandler(400)
def bad_request(e):
    return render_template_string(ERROR_TEMPLATE, title="Bad Request", message="The request was invalid."), 400


@app.errorhandler(500)
def internal_error(e):
    return render_template_string(ERROR_TEMPLATE, title="Internal Server Error", message="An internal server error occurred."), 500


@app.errorhandler(405)
def method_not_allowed(e):
    return render_template_string(ERROR_TEMPLATE, title="Method Not Allowed", message="This method is not allowed."), 405


ERROR_TEMPLATE = """<!DOCTYPE html>
<html>
<head><title>{{ title }}</title></head>
<body>
<h1>{{ title }}</h1>
<p>{{ message }}</p>
<a href="/entries">Back to entries</a>
</body>
</html>
"""

ENTRIES_LIST_TEMPLATE = """<!DOCTYPE html>
<html>
<head><title>Wiki Entries</title></head>
<body>
<h1>Wiki Entries</h1>
{% if entries %}
<ul>
{% for entry in entries %}
    <li><a href="/entries/{{ entry.id }}">{{ entry.title }}</a></li>
{% endfor %}
</ul>
{% else %}
<p>No entries yet.</p>
{% endif %}
</body>
</html>
"""

ENTRY_DETAIL_TEMPLATE = """<!DOCTYPE html>
<html>
<head><title>{{ entry.title }}</title></head>
<body>
<h1>{{ entry.title }}</h1>
<div>{{ entry.content }}</div>
<hr>
<p><strong>Last modified by:</strong> {{ entry.last_modified_by }}</p>
<p><strong>Last modified at:</strong> {{ entry.last_modified_at }}</p>
<h3>Contributors</h3>
<ul>
{% for contributor in contributors %}
    <li>{{ contributor }}</li>
{% endfor %}
</ul>
<p><a href="/entries/{{ entry.id }}/edits">View edit history</a></p>
<p><a href="/entries">Back to entries</a></p>
</body>
</html>
"""

EDITS_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<title>Edit History - {{ entry.title }}</title>
<style>
.diff-add { color: green; }
.diff-remove { color: red; }
.diff-info { color: blue; }
pre { background: #f4f4f4; padding: 10px; border: 1px solid #ddd; overflow-x: auto; }
</style>
</head>
<body>
<h1>Edit History - {{ entry.title }}</h1>
{% if edits %}
{% for edit in edits %}
<div style="border: 1px solid #ccc; margin: 10px 0; padding: 10px;">
    <p><strong>Contributor:</strong> {{ edit.modified_by }}</p>
    <p><strong>Date:</strong> {{ edit.modified_at }}</p>
    <p><strong>Summary:</strong> {{ edit.summary }}</p>
    <h4>Changes:</h4>
    <pre>{% for line in edit.diff_lines %}{% if line.startswith('+') %}<span class="diff-add">{{ line }}</span>
{% elif line.startswith('-') %}<span class="diff-remove">{{ line }}</span>
{% elif line.startswith('@@') %}<span class="diff-info">{{ line }}</span>
{% else %}{{ line }}
{% endif %}{% endfor %}</pre>
</div>
{% endfor %}
{% else %}
<p>No edits recorded.</p>
{% endif %}
<p><a href="/entries/{{ entry.id }}">Back to entry</a></p>
<p><a href="/entries">Back to entries</a></p>
</body>
</html>
"""


@app.route('/entries', methods=['GET'])
def list_entries():
    try:
        db = get_db()
        entries = db.execute("SELECT id, title FROM entries ORDER BY title").fetchall()
        return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries)
    except Exception:
        abort(500)


@app.route('/entries', methods=['POST'])
def create_entry():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400

        title = data.get('title', '').strip()
        content = data.get('content', '').strip()
        created_by = data.get('createdBy', '').strip()

        if not title or not content or not created_by:
            return jsonify({"error": "title, content, and createdBy are required"}), 400

        entry_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        edit_id = str(uuid.uuid4())

        db = get_db()
        db.execute(
            "INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
            (entry_id, title, content, created_by, now)
        )
        db.execute(
            "INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary, previous_content) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (edit_id, entry_id, content, created_by, now, "Initial creation", "")
        )
        db.commit()

        return jsonify({
            "id": entry_id,
            "title": title,
            "content": content,
            "lastModifiedBy": created_by,
            "lastModifiedAt": now
        }), 201
    except Exception:
        abort(500)


@app.route('/entries/<string:entryId>', methods=['GET'])
def get_entry(entryId):
    try:
        db = get_db()
        entry = db.execute("SELECT * FROM entries WHERE id = ?", (entryId,)).fetchone()
        if not entry:
            abort(404)

        contributors = db.execute(
            "SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by",
            (entryId,)
        ).fetchall()
        contributor_list = [c['modified_by'] for c in contributors]

        entry_dict = {
            'id': entry['id'],
            'title': entry['title'],
            'content': entry['content'],
            'last_modified_by': entry['last_modified_by'],
            'last_modified_at': entry['last_modified_at']
        }

        return render_template_string(ENTRY_DETAIL_TEMPLATE, entry=entry_dict, contributors=contributor_list)
    except Exception as e:
        if hasattr(e, 'code') and e.code == 404:
            raise
        abort(500)


@app.route('/entries/<string:entryId>', methods=['PUT'])
def update_entry(entryId):
    try:
        db = get_db()
        entry = db.execute("SELECT * FROM entries WHERE id = ?", (entryId,)).fetchone()
        if not entry:
            return jsonify({"error": "Entry not found"}), 404

        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400

        content = data.get('content', '').strip()
        modified_by = data.get('modifiedBy', '').strip()
        summary = data.get('summary', '').strip()

        if not content or not modified_by or not summary:
            return jsonify({"error": "content, modifiedBy, and summary are required"}), 400

        now = datetime.now(timezone.utc).isoformat()
        edit_id = str(uuid.uuid4())
        previous_content = entry['content']

        db.execute(
            "UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
            (content, modified_by, now, entryId)
        )
        db.execute(
            "INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary, previous_content) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (edit_id, entryId, content, modified_by, now, summary, previous_content)
        )
        db.commit()

        title = entry['title']
        return jsonify({
            "id": entryId,
            "title": title,
            "content": content,
            "lastModifiedBy": modified_by,
            "lastModifiedAt": now
        }), 200
    except Exception as e:
        if isinstance(e, Exception) and hasattr(e, 'code'):
            raise
        abort(500)


@app.route('/entries/<string:entryId>/edits', methods=['GET'])
def get_edits(entryId):
    try:
        db = get_db()
        entry = db.execute("SELECT * FROM entries WHERE id = ?", (entryId,)).fetchone()
        if not entry:
            abort(404)

        edits = db.execute(
            "SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at ASC",
            (entryId,)
        ).fetchall()

        edit_list = []
        for edit in edits:
            previous = edit['previous_content']
            current = edit['content']
            diff = list(difflib.unified_diff(
                previous.splitlines(keepends=False),
                current.splitlines(keepends=False),
                fromfile='previous',
                tofile='current',
                lineterm=''
            ))
            edit_list.append({
                'modified_by': edit['modified_by'],
                'modified_at': edit['modified_at'],
                'summary': edit['summary'],
                'diff_lines': diff
            })

        entry_dict = {
            'id': entry['id'],
            'title': entry['title']
        }

        return render_template_string(EDITS_TEMPLATE, entry=entry_dict, edits=edit_list)
    except Exception as e:
        if hasattr(e, 'code') and e.code == 404:
            raise
        abort(500)


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)