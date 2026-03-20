from flask import Flask, render_template_string, request, jsonify, abort, make_response
import sqlite3
import json
import datetime
import uuid
import difflib
from markupsafe import Markup, escape
import secrets
import hashlib

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(32)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# CSRF token generation and validation
def generate_csrf_token():
    if '_csrf_token' not in request.cookies:
        token = secrets.token_hex(32)
    else:
        token = request.cookies.get('_csrf_token')
    return token

def validate_csrf_token(token):
    stored_token = request.cookies.get('_csrf_token')
    if not stored_token or not token:
        return False
    return secrets.compare_digest(stored_token, token)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.execute('PRAGMA foreign_keys = ON')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL UNIQUE,
            content TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            last_modified_by TEXT NOT NULL,
            last_modified_at TIMESTAMP NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id TEXT PRIMARY KEY,
            entry_id TEXT NOT NULL,
            content TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            modified_at TIMESTAMP NOT NULL,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Database helper functions
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.execute('PRAGMA foreign_keys = ON')
    conn.row_factory = sqlite3.Row
    return conn

# HTML templates
BASE_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Wiki</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .entry { margin-bottom: 10px; }
        .entry-link { color: #0066cc; text-decoration: none; }
        .entry-link:hover { text-decoration: underline; }
        .metadata { color: #666; font-size: 0.9em; }
        .diff-added { background-color: #90EE90; }
        .diff-removed { background-color: #FFB6C1; }
        .edit-history { margin-top: 20px; }
        .edit-item { border: 1px solid #ddd; padding: 10px; margin-bottom: 10px; }
        form { margin-top: 20px; }
        input[type="text"], textarea { width: 100%; padding: 5px; margin: 5px 0; }
        button { padding: 5px 10px; }
    </style>
</head>
<body>
    <h1>Wiki</h1>
    <a href="/">Home</a>
    <hr>
    {% block content %}{% endblock %}
</body>
</html>
'''

ENTRIES_LIST_TEMPLATE = '''
{% extends "base.html" %}
{% block content %}
    <h2>All Entries</h2>
    {% if entries %}
        {% for entry in entries %}
            <div class="entry">
                <a href="/entries/{{ entry.id }}" class="entry-link">{{ entry.title }}</a>
            </div>
        {% endfor %}
    {% else %}
        <p>No entries yet.</p>
    {% endif %}
    
    <h3>Create New Entry</h3>
    <form method="POST" action="/entries">
        <input type="hidden" name="csrf_token" value="{{ csrf_token }}">
        <input type="text" name="title" placeholder="Title" required><br>
        <textarea name="content" placeholder="Content" rows="10" required></textarea><br>
        <input type="text" name="created_by" placeholder="Your name" required><br>
        <button type="submit">Create Entry</button>
    </form>
{% endblock %}
'''

ENTRY_DETAIL_TEMPLATE = '''
{% extends "base.html" %}
{% block content %}
    <h2>{{ entry.title }}</h2>
    <div class="metadata">
        Last modified by {{ entry.last_modified_by }} on {{ entry.last_modified_at }}
    </div>
    <div class="metadata">
        Contributors: {{ contributors }}
    </div>
    <hr>
    <div>{{ content }}</div>
    
    <h3>Edit Entry</h3>
    <form method="POST" action="/entries/{{ entry.id }}">
        <input type="hidden" name="_method" value="PUT">
        <input type="hidden" name="csrf_token" value="{{ csrf_token }}">
        <textarea name="content" rows="10" required>{{ entry.content }}</textarea><br>
        <input type="text" name="modified_by" placeholder="Your name" required><br>
        <input type="text" name="summary" placeholder="Edit summary" required><br>
        <button type="submit">Update Entry</button>
    </form>
    
    <p><a href="/entries/{{ entry.id }}/edits">View edit history</a></p>
{% endblock %}
'''

EDIT_HISTORY_TEMPLATE = '''
{% extends "base.html" %}
{% block content %}
    <h2>Edit History for "{{ entry.title }}"</h2>
    <a href="/entries/{{ entry.id }}">Back to entry</a>
    
    <div class="edit-history">
        {% for edit in edits %}
            <div class="edit-item">
                <div class="metadata">
                    Edited by {{ edit.modified_by }} on {{ edit.modified_at }}
                    {% if edit.summary %}
                        <br>Summary: {{ edit.summary }}
                    {% endif %}
                </div>
                <div class="diff">
                    <h4>Changes:</h4>
                    {{ edit.diff|safe }}
                </div>
            </div>
        {% endfor %}
    </div>
{% endblock %}
'''

@app.route('/entries', methods=['GET', 'POST'])
def entries():
    if request.method == 'GET':
        try:
            conn = get_db_connection()
            entries = conn.execute('SELECT id, title FROM entries ORDER BY title').fetchall()
            conn.close()
            
            csrf_token = generate_csrf_token()
            response = make_response(render_template_string(
                ENTRIES_LIST_TEMPLATE,
                entries=entries,
                csrf_token=csrf_token,
                template_string=BASE_TEMPLATE
            ))
            response.set_cookie('_csrf_token', csrf_token, httponly=True, samesite='Strict')
            return response
        except Exception:
            abort(500)
    
    elif request.method == 'POST':
        try:
            # Validate CSRF token
            csrf_token = request.form.get('csrf_token')
            if not validate_csrf_token(csrf_token):
                abort(403)
            
            # Parse form data
            title = request.form.get('title', '').strip()
            content = request.form.get('content', '').strip()
            created_by = request.form.get('created_by', '').strip()
            
            if not all([title, content, created_by]):
                abort(400)
            
            entry_id = str(uuid.uuid4())
            now = datetime.datetime.utcnow().isoformat()
            
            conn = get_db_connection()
            try:
                conn.execute('''
                    INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (entry_id, title, content, created_by, now, created_by, now))
                
                # Add initial edit record
                edit_id = str(uuid.uuid4())
                conn.execute('''
                    INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (edit_id, entry_id, content, created_by, now, 'Initial creation'))
                
                conn.commit()
            except sqlite3.IntegrityError:
                conn.close()
                abort(400)  # Duplicate title
            
            conn.close()
            
            return jsonify({
                'id': entry_id,
                'title': title,
                'content': content,
                'lastModifiedBy': created_by,
                'lastModifiedAt': now
            }), 201
        except Exception:
            abort(500)

@app.route('/entries/<entry_id>', methods=['GET', 'POST'])
def entry_detail(entry_id):
    if request.method == 'GET':
        try:
            conn = get_db_connection()
            entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
            
            if not entry:
                conn.close()
                abort(404)
            
            # Get contributors
            contributors = conn.execute('''
                SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?
            ''', (entry_id,)).fetchall()
            conn.close()
            
            contributors_list = ', '.join([escape(c['modified_by']) for c in contributors])
            
            # Escape content for safe display
            safe_content = Markup(escape(entry['content']).replace('\n', '<br>'))
            
            csrf_token = generate_csrf_token()
            response = make_response(render_template_string(
                ENTRY_DETAIL_TEMPLATE,
                entry=entry,
                content=safe_content,
                contributors=contributors_list,
                csrf_token=csrf_token,
                template_string=BASE_TEMPLATE
            ))
            response.set_cookie('_csrf_token', csrf_token, httponly=True, samesite='Strict')
            return response
        except Exception:
            abort(500)
    
    elif request.method == 'POST' and request.form.get('_method') == 'PUT':
        try:
            # Validate CSRF token
            csrf_token = request.form.get('csrf_token')
            if not validate_csrf_token(csrf_token):
                abort(403)
            
            # Parse form data
            content = request.form.get('content', '').strip()
            modified_by = request.form.get('modified_by', '').strip()
            summary = request.form.get('summary', '').strip()
            
            if not all([content, modified_by, summary]):
                abort(400)
            
            conn = get_db_connection()
            entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
            
            if not entry:
                conn.close()
                abort(404)
            
            now = datetime.datetime.utcnow().isoformat()
            
            # Update entry
            conn.execute('''
                UPDATE entries 
                SET content = ?, last_modified_by = ?, last_modified_at = ?
                WHERE id = ?
            ''', (content, modified_by, now, entry_id))
            
            # Add edit record
            edit_id = str(uuid.uuid4())
            conn.execute('''
                INSERT INTO edits (id, entry_id, content, modified_by, modified_at, summary)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (edit_id, entry_id, content, modified_by, now, summary))
            
            conn.commit()
            conn.close()
            
            return jsonify({
                'id': entry_id,
                'title': entry['title'],
                'content': content,
                'lastModifiedBy': modified_by,
                'lastModifiedAt': now
            })
        except Exception:
            abort(500)

@app.route('/entries/<entry_id>/edits')
def edit_history(entry_id):
    try:
        conn = get_db_connection()
        entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
        
        if not entry:
            conn.close()
            abort(404)
        
        edits = conn.execute('''
            SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC
        ''', (entry_id,)).fetchall()
        
        conn.close()
        
        # Process edits to create diffs
        processed_edits = []
        previous_content = ""
        
        for i in range(len(edits) - 1, -1, -1):
            edit = edits[i]
            current_content = edit['content']
            
            # Create diff
            diff_lines = list(difflib.unified_diff(
                previous_content.splitlines(keepends=True),
                current_content.splitlines(keepends=True),
                lineterm=''
            ))
            
            diff_html = ""
            for line in diff_lines[2:]:  # Skip header lines
                if line.startswith('+'):
                    diff_html += f'<div class="diff-added">{escape(line)}</div>'
                elif line.startswith('-'):
                    diff_html += f'<div class="diff-removed">{escape(line)}</div>'
                else:
                    diff_html += f'<div>{escape(line)}</div>'
            
            processed_edits.insert(0, {
                'modified_by': escape(edit['modified_by']),
                'modified_at': edit['modified_at'],
                'summary': escape(edit['summary']) if edit['summary'] else None,
                'diff': Markup(diff_html) if diff_html else Markup('<p>No changes</p>')
            })
            
            previous_content = current_content
        
        return render_template_string(
            EDIT_HISTORY_TEMPLATE,
            entry=entry,
            edits=processed_edits,
            template_string=BASE_TEMPLATE
        )
    except Exception:
        abort(500)

@app.route('/')
def index():
    return entries()

@app.errorhandler(400)
def bad_request(e):
    return "Bad Request", 400

@app.errorhandler(403)
def forbidden(e):
    return "Forbidden", 403

@app.errorhandler(404)
def not_found(e):
    return "Not Found", 404

@app.errorhandler(500)
def internal_error(e):
    return "Internal Server Error", 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)