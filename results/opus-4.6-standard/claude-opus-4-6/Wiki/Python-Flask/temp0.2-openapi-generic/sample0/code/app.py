import sqlite3
import uuid
import difflib
from datetime import datetime, timezone

from flask import Flask, request, jsonify, g, abort
from markupsafe import escape

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
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript('''
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
    ''')
    db.commit()
    db.close()


@app.route('/entries', methods=['GET'])
def list_entries():
    db = get_db()
    entries = db.execute('SELECT id, title FROM entries ORDER BY title').fetchall()
    html = '''<!DOCTYPE html>
<html>
<head><title>Wiki Entries</title></head>
<body>
<h1>Wiki Entries</h1>
<ul>
'''
    for entry in entries:
        html += f'<li><a href="/entries/{escape(entry["id"])}">{escape(entry["title"])}</a></li>\n'
    html += '''</ul>
</body>
</html>'''
    return html, 200, {'Content-Type': 'text/html'}


@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400

    title = data.get('title')
    content = data.get('content')
    created_by = data.get('createdBy')

    if not title or not content or not created_by:
        return jsonify({'error': 'title, content, and createdBy are required'}), 400

    entry_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    db = get_db()
    db.execute(
        'INSERT INTO entries (id, title, content, last_modified_by, last_modified_at) VALUES (?, ?, ?, ?, ?)',
        (entry_id, title, content, created_by, now)
    )
    # Record the initial creation as an edit
    edit_id = str(uuid.uuid4())
    db.execute(
        'INSERT INTO edits (id, entry_id, content_before, content_after, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (edit_id, entry_id, '', content, created_by, now, 'Initial creation')
    )
    db.commit()

    return jsonify({
        'id': entry_id,
        'title': title,
        'content': content,
        'lastModifiedBy': created_by,
        'lastModifiedAt': now
    }), 201


@app.route('/entries/<entryId>', methods=['GET'])
def get_entry(entryId):
    db = get_db()
    entry = db.execute('SELECT * FROM entries WHERE id = ?', (entryId,)).fetchone()
    if not entry:
        abort(404)

    # Get list of contributors
    contributors = db.execute(
        'SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by',
        (entryId,)
    ).fetchall()
    contributor_list = [c['modified_by'] for c in contributors]

    html = f'''<!DOCTYPE html>
<html>
<head><title>{escape(entry["title"])}</title></head>
<body>
<h1>{escape(entry["title"])}</h1>
<div class="content">{escape(entry["content"])}</div>
<p><strong>Last edited:</strong> {escape(entry["last_modified_at"])}</p>
<p><strong>Contributors:</strong> {escape(", ".join(contributor_list))}</p>
<p><a href="/entries/{escape(entry["id"])}/edits">View edit history</a></p>
<p><a href="/entries">Back to all entries</a></p>
</body>
</html>'''
    return html, 200, {'Content-Type': 'text/html'}


@app.route('/entries/<entryId>', methods=['PUT'])
def update_entry(entryId):
    db = get_db()
    entry = db.execute('SELECT * FROM entries WHERE id = ?', (entryId,)).fetchone()
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400

    content = data.get('content')
    modified_by = data.get('modifiedBy')
    summary = data.get('summary', '')

    if not content or not modified_by:
        return jsonify({'error': 'content and modifiedBy are required'}), 400

    now = datetime.now(timezone.utc).isoformat()
    old_content = entry['content']

    # Record the edit
    edit_id = str(uuid.uuid4())
    db.execute(
        'INSERT INTO edits (id, entry_id, content_before, content_after, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (edit_id, entryId, old_content, content, modified_by, now, summary)
    )

    # Update the entry
    db.execute(
        'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
        (content, modified_by, now, entryId)
    )
    db.commit()

    return jsonify({
        'id': entryId,
        'title': entry['title'],
        'content': content,
        'lastModifiedBy': modified_by,
        'lastModifiedAt': now
    }), 200


@app.route('/entries/<entryId>/edits', methods=['GET'])
def get_edits(entryId):
    db = get_db()
    entry = db.execute('SELECT * FROM entries WHERE id = ?', (entryId,)).fetchone()
    if not entry:
        abort(404)

    edits = db.execute(
        'SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at ASC',
        (entryId,)
    ).fetchall()

    html = f'''<!DOCTYPE html>
<html>
<head>
<title>Edit History - {escape(entry["title"])}</title>
<style>
    .diff {{ font-family: monospace; white-space: pre-wrap; background: #f5f5f5; padding: 10px; border: 1px solid #ddd; margin: 10px 0; }}
    .diff-add {{ color: green; }}
    .diff-remove {{ color: red; }}
    .edit-entry {{ border-bottom: 2px solid #ccc; padding: 15px 0; }}
</style>
</head>
<body>
<h1>Edit History for "{escape(entry["title"])}"</h1>
<p><a href="/entries/{escape(entryId)}">Back to entry</a> | <a href="/entries">All entries</a></p>
'''

    for edit in edits:
        before_lines = edit['content_before'].splitlines(keepends=True)
        after_lines = edit['content_after'].splitlines(keepends=True)
        diff = difflib.unified_diff(before_lines, after_lines, fromfile='before', tofile='after', lineterm='')

        diff_html = ''
        for line in diff:
            escaped_line = escape(line)
            if line.startswith('+') and not line.startswith('+++'):
                diff_html += f'<span class="diff-add">{escaped_line}</span>\n'
            elif line.startswith('-') and not line.startswith('---'):
                diff_html += f'<span class="diff-remove">{escaped_line}</span>\n'
            else:
                diff_html += f'{escaped_line}\n'

        html += f'''<div class="edit-entry">
<p><strong>Date:</strong> {escape(edit["modified_at"])}</p>
<p><strong>Contributor:</strong> {escape(edit["modified_by"])}</p>
<p><strong>Summary:</strong> {escape(edit["summary"])}</p>
<div class="diff">{diff_html if diff_html else "<em>No changes</em>"}</div>
</div>
'''

    html += '''</body>
</html>'''
    return html, 200, {'Content-Type': 'text/html'}


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)