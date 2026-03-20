import sqlite3
import json
import hashlib
import secrets
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string, make_response, abort
from werkzeug.exceptions import HTTPException
from markupsafe import escape
import difflib

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(32)

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create entries table
    c.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL,
            last_modified_by TEXT NOT NULL,
            last_modified_at TIMESTAMP NOT NULL
        )
    ''')
    
    # Create edits history table
    c.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id TEXT NOT NULL,
            content TEXT NOT NULL,
            edited_by TEXT NOT NULL,
            edited_at TIMESTAMP NOT NULL,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Error handler to prevent information leakage (CWE-209)
@app.errorhandler(Exception)
def handle_error(error):
    if isinstance(error, HTTPException):
        return jsonify({'error': error.description}), error.code
    # Log the actual error internally but don't expose details
    app.logger.error(f"Unhandled exception: {error}")
    return jsonify({'error': 'An internal error occurred'}), 500

# HTML templates with proper escaping to prevent XSS (CWE-79)
ENTRIES_LIST_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 10px 0; }
        a { color: #007bff; text-decoration: none; }
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
    <title>{{ title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .meta { color: #666; font-size: 0.9em; margin-bottom: 20px; }
        .content { line-height: 1.6; white-space: pre-wrap; }
        .contributors { margin-top: 30px; }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>{{ title }}</h1>
    <div class="meta">
        Last modified: {{ last_modified_at }} by {{ last_modified_by }}
        <br><a href="/entries/{{ entry_id }}/edits">View edit history</a>
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
</body>
</html>
'''

EDITS_HISTORY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Edit History - {{ title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 20px 0; padding: 15px; }
        .edit-meta { color: #666; font-size: 0.9em; margin-bottom: 10px; }
        .diff { background-color: #f5f5f5; padding: 10px; font-family: monospace; white-space: pre-wrap; overflow-x: auto; }
        .added { color: green; }
        .removed { color: red; }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History - {{ title }}</h1>
    <p><a href="/entries/{{ entry_id }}">Back to entry</a></p>
    {% for edit in edits %}
    <div class="edit">
        <div class="edit-meta">
            Edited by: {{ edit.edited_by }} on {{ edit.edited_at }}
            {% if edit.summary %}<br>Summary: {{ edit.summary }}{% endif %}
        </div>
        <div class="diff">{{ edit.diff | safe }}</div>
    </div>
    {% endfor %}
</body>
</html>
'''

def generate_entry_id(title):
    """Generate a URL-safe ID from title"""
    return hashlib.md5(title.encode()).hexdigest()[:8] + '_' + ''.join(c if c.isalnum() else '_' for c in title.lower())[:20]

@app.route('/entries', methods=['GET', 'POST'])
def entries():
    try:
        if request.method == 'GET':
            conn = sqlite3.connect('db.sqlite3')
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            # Using parameterized queries to prevent SQL injection (CWE-89)
            c.execute('SELECT id, title FROM entries ORDER BY last_modified_at DESC')
            entries = c.fetchall()
            conn.close()
            
            # Escape all user data to prevent XSS (CWE-79)
            entries_list = [{'id': escape(row['id']), 'title': escape(row['title'])} for row in entries]
            html = render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries_list)
            response = make_response(html)
            response.headers['Content-Type'] = 'text/html; charset=utf-8'
            return response
        
        elif request.method == 'POST':
            data = request.get_json()
            if not data:
                abort(400, description='Invalid JSON')
            
            title = data.get('title', '').strip()
            content = data.get('content', '').strip()
            created_by = data.get('createdBy', '').strip()
            
            # Input validation
            if not all([title, content, created_by]):
                abort(400, description='Missing required fields')
            
            # Limit input sizes to prevent DoS
            if len(title) > 200 or len(content) > 100000 or len(created_by) > 100:
                abort(400, description='Input too large')
            
            entry_id = generate_entry_id(title)
            now = datetime.utcnow().isoformat()
            
            conn = sqlite3.connect('db.sqlite3')
            c = conn.cursor()
            
            # Check if entry already exists
            c.execute('SELECT id FROM entries WHERE id = ?', (entry_id,))
            if c.fetchone():
                conn.close()
                abort(409, description='Entry with this title already exists')
            
            # Insert new entry using parameterized queries (CWE-89)
            c.execute('''
                INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (entry_id, title, content, created_by, now, created_by, now))
            
            # Add initial edit record
            c.execute('''
                INSERT INTO edits (entry_id, content, edited_by, edited_at, summary)
                VALUES (?, ?, ?, ?, ?)
            ''', (entry_id, content, created_by, now, 'Initial creation'))
            
            conn.commit()
            conn.close()
            
            return jsonify({
                'id': entry_id,
                'title': title,
                'content': content,
                'lastModifiedBy': created_by,
                'lastModifiedAt': now
            }), 201
            
    except HTTPException:
        raise
    except Exception as e:
        # Proper error handling without exposing internals (CWE-209, CWE-703)
        app.logger.error(f"Error in /entries: {e}")
        abort(500, description='An internal error occurred')

@app.route('/entries/<string:entry_id>', methods=['GET', 'PUT'])
def entry_detail(entry_id):
    try:
        # Validate entry_id to prevent path traversal
        if '..' in entry_id or '/' in entry_id or '\\' in entry_id:
            abort(400, description='Invalid entry ID')
        
        if request.method == 'GET':
            conn = sqlite3.connect('db.sqlite3')
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            
            # Get entry details using parameterized query (CWE-89)
            c.execute('''
                SELECT id, title, content, last_modified_by, last_modified_at 
                FROM entries 
                WHERE id = ?
            ''', (entry_id,))
            entry = c.fetchone()
            
            if not entry:
                conn.close()
                abort(404, description='Entry not found')
            
            # Get all contributors
            c.execute('''
                SELECT DISTINCT edited_by 
                FROM edits 
                WHERE entry_id = ?
                ORDER BY edited_by
            ''', (entry_id,))
            contributors = [escape(row['edited_by']) for row in c.fetchall()]
            
            conn.close()
            
            # Escape all user data to prevent XSS (CWE-79)
            html = render_template_string(ENTRY_DETAIL_TEMPLATE,
                entry_id=escape(entry['id']),
                title=escape(entry['title']),
                content=escape(entry['content']),
                last_modified_by=escape(entry['last_modified_by']),
                last_modified_at=escape(entry['last_modified_at']),
                contributors=contributors
            )
            
            response = make_response(html)
            response.headers['Content-Type'] = 'text/html; charset=utf-8'
            return response
        
        elif request.method == 'PUT':
            data = request.get_json()
            if not data:
                abort(400, description='Invalid JSON')
            
            content = data.get('content', '').strip()
            modified_by = data.get('modifiedBy', '').strip()
            summary = data.get('summary', '').strip()
            
            # Input validation - summary is required per schema
            if not all([content, modified_by, summary]):
                abort(400, description='Missing required fields')
            
            # Limit input sizes
            if len(content) > 100000 or len(modified_by) > 100 or len(summary) > 500:
                abort(400, description='Input too large')
            
            conn = sqlite3.connect('db.sqlite3')
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            
            # Check if entry exists
            c.execute('SELECT id, title, content FROM entries WHERE id = ?', (entry_id,))
            entry = c.fetchone()
            
            if not entry:
                conn.close()
                abort(404, description='Entry not found')
            
            now = datetime.utcnow().isoformat()
            
            # Update entry using parameterized queries (CWE-89)
            c.execute('''
                UPDATE entries 
                SET content = ?, last_modified_by = ?, last_modified_at = ?
                WHERE id = ?
            ''', (content, modified_by, now, entry_id))
            
            # Add edit record
            c.execute('''
                INSERT INTO edits (entry_id, content, edited_by, edited_at, summary)
                VALUES (?, ?, ?, ?, ?)
            ''', (entry_id, content, modified_by, now, summary))
            
            conn.commit()
            conn.close()
            
            return jsonify({
                'id': entry_id,
                'title': entry['title'],
                'content': content,
                'lastModifiedBy': modified_by,
                'lastModifiedAt': now
            }), 200
            
    except HTTPException:
        raise
    except Exception as e:
        # Proper error handling without exposing internals (CWE-209, CWE-703)
        app.logger.error(f"Error in /entries/{entry_id}: {e}")
        abort(500, description='An internal error occurred')

@app.route('/entries/<string:entry_id>/edits', methods=['GET'])
def entry_edits(entry_id):
    try:
        # Validate entry_id
        if '..' in entry_id or '/' in entry_id or '\\' in entry_id:
            abort(400, description='Invalid entry ID')
        
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        # Check if entry exists and get title
        c.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
        entry = c.fetchone()
        
        if not entry:
            conn.close()
            abort(404, description='Entry not found')
        
        # Get all edits using parameterized query (CWE-89)
        c.execute('''
            SELECT content, edited_by, edited_at, summary 
            FROM edits 
            WHERE entry_id = ?
            ORDER BY edited_at DESC
        ''', (entry_id,))
        edits = c.fetchall()
        
        conn.close()
        
        # Process edits and create diffs
        edits_with_diff = []
        previous_content = ''
        
        for i in range(len(edits)-1, -1, -1):  # Process in chronological order
            edit = edits[i]
            current_content = edit['content']
            
            # Generate diff
            diff_lines = list(difflib.unified_diff(
                previous_content.splitlines(keepends=True),
                current_content.splitlines(keepends=True),
                lineterm=''
            ))
            
            diff_html = []
            for line in diff_lines:
                # Escape each line before adding styling to prevent XSS
                escaped_line = escape(line)
                if line.startswith('+') and not line.startswith('+++'):
                    diff_html.append(f'<span class="added">{escaped_line}</span>')
                elif line.startswith('-') and not line.startswith('---'):
                    diff_html.append(f'<span class="removed">{escaped_line}</span>')
                else:
                    diff_html.append(escaped_line)
            
            edits_with_diff.append({
                'edited_by': escape(edit['edited_by']),
                'edited_at': escape(edit['edited_at']),
                'summary': escape(edit['summary']) if edit['summary'] else None,
                'diff': '\n'.join(diff_html) if diff_html else 'No changes'
            })
            
            previous_content = current_content
        
        edits_with_diff.reverse()  # Show most recent first
        
        html = render_template_string(EDITS_HISTORY_TEMPLATE,
            entry_id=escape(entry_id),
            title=escape(entry['title']),
            edits=edits_with_diff
        )
        
        response = make_response(html)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        # Proper error handling without exposing internals (CWE-209, CWE-703)
        app.logger.error(f"Error in /entries/{entry_id}/edits: {e}")
        abort(500, description='An internal error occurred')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)