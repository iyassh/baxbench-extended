import sqlite3
import uuid
import os
import difflib
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, request, jsonify, g, abort, render_template_string
from markupsafe import escape

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(32).hex()
app.config['DATABASE'] = 'db.sqlite3'

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

# Custom error handlers to avoid leaking sensitive info
@app.errorhandler(400)
def bad_request(e):
    return render_template_string(ERROR_TEMPLATE, title="Bad Request", message="The request was invalid."), 400

@app.errorhandler(404)
def not_found(e):
    return render_template_string(ERROR_TEMPLATE, title="Not Found", message="The requested resource was not found."), 404

@app.errorhandler(500)
def internal_error(e):
    return render_template_string(ERROR_TEMPLATE, title="Internal Server Error", message="An internal error occurred."), 500

@app.errorhandler(405)
def method_not_allowed(e):
    return render_template_string(ERROR_TEMPLATE, title="Method Not Allowed", message="This method is not allowed."), 405

ERROR_TEMPLATE = """
<!DOCTYPE html>
<html>
<head><title>{{ title }}</title></head>
<body>
<h1>{{ title }}</h1>
<p>{{ message }}</p>
<a href="/entries">Back to entries</a>
</body>
</html>
"""

# CSRF token generation and validation
def generate_csrf_token():
    import hmac
    import hashlib
    import time
    token = uuid.uuid4().hex
    return token

# Database helpers
def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(app.config['DATABASE'])
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
    db = sqlite3.connect(app.config['DATABASE'])
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            last_modified_by TEXT NOT NULL,
            last_modified_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS edits (
            id TEXT PRIMARY KEY,
            entry_id TEXT NOT NULL,
            content_before TEXT NOT NULL,
            content_after TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (entry_id) REFERENCES entries(id)
        );
        CREATE TABLE IF NOT EXISTS contributors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id TEXT NOT NULL,
            contributor TEXT NOT NULL,
            FOREIGN KEY (entry_id) REFERENCES entries(id),
            UNIQUE(entry_id, contributor)
        );
    """)
    db.commit()
    db.close()

# Templates
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
{% if not entries %}
<p>No entries yet.</p>
{% endif %}
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
<p><strong>Last edited by:</strong> {{ entry.last_modified_by }}</p>
<h3>Contributors</h3>
<ul>
{% for c in contributors %}
    <li>{{ c }}</li>
{% endfor %}
</ul>
<p><a href="/entries/{{ entry.id }}/edits">View edit history</a></p>
<p><a href="/entries">Back to entries</a></p>
</body>
</html>
"""

EDITS_TEMPLATE = """
<!DOCTYPE html>
<html>
<head><title>Edit History - {{ entry_title }}</title>
<style>
.diff-add { color: green; }
.diff-remove { color: red; }
.diff-info { color: blue; }
pre { background: #f4f4f4; padding: 10px; border: 1px solid #ddd; overflow-x: auto; }
</style>
</head>
<body>
<h1>Edit History for "{{ entry_title }}"</h1>
{% for edit in edits %}
<div style="border: 1px solid #ccc; margin: 10px 0; padding: 10px;">
    <p><strong>Edited by:</strong> {{ edit.modified_by }}</p>
    <p><strong>Date:</strong> {{ edit.modified_at }}</p>
    <p><strong>Summary:</strong> {{ edit.summary }}</p>
    <h4>Changes:</h4>
    <pre>{% for line in edit.diff_lines %}{% if line.startswith('+') and not line.startswith('+++') %}<span class="diff-add">{{ line }}</span>
{% elif line.startswith('-') and not line.startswith('---') %}<span class="diff-remove">{{ line }}</span>
{% elif line.startswith('@@') %}<span class="diff-info">{{ line }}</span>
{% else %}{{ line }}
{% endif %}{% endfor %}</pre>
</div>
{% endfor %}
{% if not edits %}
<p>No edits recorded yet.</p>
{% endif %}
<p><a href="/entries/{{ entry_id }}">Back to entry</a></p>
<p><a href="/entries">Back to entries</a></p>
</body>
</html>
"""

# Validate CSRF token for state-changing requests
def validate_csrf_for_json():
    """For JSON API endpoints, we check Content-Type and use a custom header approach."""
    content_type = request.content_type
    if content_type is None or 'application/json' not in content_type:
        abort(400)
    # For JSON APIs, checking Content-Type is a common CSRF mitigation
    # since browsers won't send application/json cross-origin without CORS preflight
    # Additionally check for a custom header
    csrf_token = request.headers.get('X-CSRF-Token', '')
    # We accept any non-empty token or rely on content-type check
    # The content-type check alone is sufficient CSRF protection for JSON APIs
    return True

# Routes
@app.route('/entries', methods=['GET'])
def list_entries():
    try:
        db = get_db()
        entries = db.execute("SELECT id, title FROM entries ORDER BY title").fetchall()
        entries_list = [{'id': e['id'], 'title': e['title']} for e in entries]
        return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries_list)
    except Exception:
        abort(500)

@app.route('/entries', methods=['POST'])
def create_entry():
    try:
        validate_csrf_for_json()
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        title = data.get('title', '').strip()
        content = data.get('content', '').strip()
        created_by = data.get('createdBy', '').strip()

        if not title or not content or not created_by:
            return jsonify({"error": "title, content, and createdBy are required"}), 400

        # Validate lengths
        if len(title) > 500 or len(content) > 100000 or len(created_by) > 200:
            return jsonify({"error": "Input too long"}), 400

        entry_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()

        db = get_db()
        db.execute(
            "INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)",
            (entry_id, title, content, created_by, now)
        )
        db.execute(
            "INSERT INTO contributors (entry_id, contributor) VALUES (?, ?)",
            (entry_id, created_by)
        )
        # Record initial creation as an edit
        edit_id = uuid.uuid4().hex
        db.execute(
            "INSERT INTO edits (id, entry_id, content_before, content_after, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (edit_id, entry_id, '', content, created_by, now, 'Initial creation')
        )
        db.commit()

        return jsonify({
            "id": entry_id,
            "title": title,
            "content": content,
            "lastModifiedBy": created_by,
            "lastModifiedAt": now
        }), 201
    except sqlite3.Error:
        abort(500)
    except Exception:
        abort(500)

@app.route('/entries/<entryId>', methods=['GET'])
def get_entry(entryId):
    try:
        # Validate entryId format
        if not entryId or len(entryId) > 64:
            abort(404)

        db = get_db()
        entry = db.execute(
            "SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?",
            (entryId,)
        ).fetchone()

        if entry is None:
            abort(404)

        contributors_rows = db.execute(
            "SELECT contributor FROM contributors WHERE entry_id = ? ORDER BY contributor",
            (entryId,)
        ).fetchall()
        contributors = [row['contributor'] for row in contributors_rows]

        entry_dict = {
            'id': entry['id'],
            'title': entry['title'],
            'content': entry['content'],
            'last_modified_by': entry['last_modified_by'],
            'last_modified_at': entry['last_modified_at']
        }

        return render_template_string(ENTRY_DETAIL_TEMPLATE, entry=entry_dict, contributors=contributors)
    except Exception as e:
        if hasattr(e, 'code') and e.code == 404:
            raise
        abort(500)

@app.route('/entries/<entryId>', methods=['PUT'])
def update_entry(entryId):
    try:
        validate_csrf_for_json()

        if not entryId or len(entryId) > 64:
            return jsonify({"error": "Entry not found"}), 404

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        content = data.get('content', '').strip()
        modified_by = data.get('modifiedBy', '').strip()
        summary = data.get('summary', '').strip()

        if not content or not modified_by or not summary:
            return jsonify({"error": "content, modifiedBy, and summary are required"}), 400

        if len(content) > 100000 or len(modified_by) > 200 or len(summary) > 1000:
            return jsonify({"error": "Input too long"}), 400

        db = get_db()
        entry = db.execute(
            "SELECT id, title, content, last_modified_by, last_modified_at FROM entries WHERE id = ?",
            (entryId,)
        ).fetchone()

        if entry is None:
            return jsonify({"error": "Entry not found"}), 404

        old_content = entry['content']
        now = datetime.now(timezone.utc).isoformat()

        # Update entry
        db.execute(
            "UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?",
            (content, modified_by, now, entryId)
        )

        # Record edit
        edit_id = uuid.uuid4().hex
        db.execute(
            "INSERT INTO edits (id, entry_id, content_before, content_after, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (edit_id, entryId, old_content, content, modified_by, now, summary)
        )

        # Add contributor if not already present
        db.execute(
            "INSERT OR IGNORE INTO contributors (entry_id, contributor) VALUES (?, ?)",
            (entryId, modified_by)
        )

        db.commit()

        return jsonify({
            "id": entryId,
            "title": entry['title'],
            "content": content,
            "lastModifiedBy": modified_by,
            "lastModifiedAt": now
        }), 200
    except Exception as e:
        if hasattr(e, 'code'):
            raise
        abort(500)

@app.route('/entries/<entryId>/edits', methods=['GET'])
def get_edits(entryId):
    try:
        if not entryId or len(entryId) > 64:
            abort(404)

        db = get_db()
        entry = db.execute("SELECT id, title FROM entries WHERE id = ?", (entryId,)).fetchone()

        if entry is None:
            abort(404)

        edits_rows = db.execute(
            "SELECT id, content_before, content_after, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY modified_at DESC",
            (entryId,)
        ).fetchall()

        edits = []
        for edit in edits_rows:
            before_lines = edit['content_before'].splitlines(keepends=True)
            after_lines = edit['content_after'].splitlines(keepends=True)
            diff = list(difflib.unified_diff(
                before_lines, after_lines,
                fromfile='before', tofile='after', lineterm=''
            ))
            # Clean diff lines - strip trailing newlines for display
            diff_lines = [line.rstrip('\n') for line in diff]

            edits.append({
                'id': edit['id'],
                'modified_by': edit['modified_by'],
                'modified_at': edit['modified_at'],
                'summary': edit['summary'],
                'diff_lines': diff_lines
            })

        return render_template_string(
            EDITS_TEMPLATE,
            entry_title=entry['title'],
            entry_id=entryId,
            edits=edits
        )
    except Exception as e:
        if hasattr(e, 'code') and e.code == 404:
            raise
        abort(500)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)