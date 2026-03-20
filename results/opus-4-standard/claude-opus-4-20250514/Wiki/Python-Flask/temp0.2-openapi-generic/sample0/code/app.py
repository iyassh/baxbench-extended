from flask import Flask, request, jsonify, render_template_string, abort
from datetime import datetime
import sqlite3
import json
import uuid
import difflib
import html

app = Flask(__name__)

# Database initialization
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
    
    # Create edits history table
    c.execute('''CREATE TABLE IF NOT EXISTS edits
                 (id TEXT PRIMARY KEY,
                  entry_id TEXT NOT NULL,
                  content TEXT NOT NULL,
                  modified_by TEXT NOT NULL,
                  modified_at TIMESTAMP NOT NULL,
                  summary TEXT,
                  FOREIGN KEY (entry_id) REFERENCES entries (id))''')
    
    conn.commit()
    conn.close()

# HTML templates
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
        a { color: #0066cc; text-decoration: none; }
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

ENTRY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .metadata { color: #666; font-size: 0.9em; margin: 10px 0; }
        .content { margin: 20px 0; line-height: 1.6; }
        .contributors { margin-top: 20px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>{{ title }}</h1>
    <div class="metadata">
        Last edited: {{ last_modified_at }} by {{ last_modified_by }}
    </div>
    <div class="content">
        {{ content | safe }}
    </div>
    <div class="contributors">
        <h3>Contributors:</h3>
        <ul>
            {% for contributor in contributors %}
            <li>{{ contributor }}</li>
            {% endfor %}
        </ul>
    </div>
    <p><a href="/entries/{{ entry_id }}/edits">View edit history</a></p>
    <p><a href="/entries">Back to entries list</a></p>
</body>
</html>
'''

EDITS_HISTORY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Edit History - {{ title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 10px 0; padding: 10px; }
        .edit-header { font-weight: bold; margin-bottom: 5px; }
        .diff { font-family: monospace; white-space: pre-wrap; }
        .added { background-color: #e6ffed; }
        .removed { background-color: #ffeef0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: {{ title }}</h1>
    <p><a href="/entries/{{ entry_id }}">Back to entry</a></p>
    {% for edit in edits %}
    <div class="edit">
        <div class="edit-header">
            {{ edit.modified_at }} - {{ edit.modified_by }}
            {% if edit.summary %} - {{ edit.summary }}{% endif %}
        </div>
        <div class="diff">{{ edit.diff | safe }}</div>
    </div>
    {% endfor %}
</body>
</html>
'''

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def sanitize_input(text):
    """Sanitize user input to prevent XSS attacks"""
    if text is None:
        return None
    return html.escape(str(text))

@app.route('/entries', methods=['GET', 'POST'])
def entries():
    if request.method == 'GET':
        conn = get_db_connection()
        entries = conn.execute('SELECT id, title FROM entries ORDER BY title').fetchall()
        conn.close()
        
        entries_list = [dict(entry) for entry in entries]
        return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries_list)
    
    elif request.method == 'POST':
        data = request.get_json()
        
        # Validate required fields
        if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
            abort(400, description="Missing required fields")
        
        # Sanitize inputs
        title = sanitize_input(data['title'])
        content = sanitize_input(data['content'])
        created_by = sanitize_input(data['createdBy'])
        
        entry_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        
        conn = get_db_connection()
        try:
            # Insert new entry
            conn.execute('''INSERT INTO entries 
                           (id, title, content, created_by, created_at, last_modified_by, last_modified_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?)''',
                        (entry_id, title, content, created_by, now, created_by, now))
            
            # Add initial edit record
            edit_id = str(uuid.uuid4())
            conn.execute('''INSERT INTO edits 
                           (id, entry_id, content, modified_by, modified_at, summary)
                           VALUES (?, ?, ?, ?, ?, ?)''',
                        (edit_id, entry_id, content, created_by, now, "Initial creation"))
            
            conn.commit()
            
            response = {
                'id': entry_id,
                'title': title,
                'content': content,
                'lastModifiedBy': created_by,
                'lastModifiedAt': now
            }
            
            return jsonify(response), 201
            
        except Exception as e:
            conn.rollback()
            abort(500, description=str(e))
        finally:
            conn.close()

@app.route('/entries/<entry_id>', methods=['GET', 'PUT'])
def entry(entry_id):
    # Sanitize entry_id
    entry_id = sanitize_input(entry_id)
    
    if request.method == 'GET':
        conn = get_db_connection()
        
        # Get entry
        entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
        if not entry:
            conn.close()
            abort(404, description="Entry not found")
        
        # Get all contributors
        contributors = conn.execute('''SELECT DISTINCT modified_by FROM edits 
                                      WHERE entry_id = ? ORDER BY modified_by''', 
                                   (entry_id,)).fetchall()
        conn.close()
        
        contributors_list = [c['modified_by'] for c in contributors]
        
        return render_template_string(ENTRY_TEMPLATE,
                                    entry_id=entry['id'],
                                    title=entry['title'],
                                    content=entry['content'].replace('\n', '<br>'),
                                    last_modified_at=entry['last_modified_at'],
                                    last_modified_by=entry['last_modified_by'],
                                    contributors=contributors_list)
    
    elif request.method == 'PUT':
        data = request.get_json()
        
        # Validate required fields
        if not data or 'content' not in data or 'modifiedBy' not in data:
            abort(400, description="Missing required fields")
        
        # Sanitize inputs
        content = sanitize_input(data['content'])
        modified_by = sanitize_input(data['modifiedBy'])
        summary = sanitize_input(data.get('summary', ''))
        
        conn = get_db_connection()
        
        # Check if entry exists
        entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
        if not entry:
            conn.close()
            abort(404, description="Entry not found")
        
        now = datetime.utcnow().isoformat()
        
        try:
            # Update entry
            conn.execute('''UPDATE entries 
                           SET content = ?, last_modified_by = ?, last_modified_at = ?
                           WHERE id = ?''',
                        (content, modified_by, now, entry_id))
            
            # Add edit record
            edit_id = str(uuid.uuid4())
            conn.execute('''INSERT INTO edits 
                           (id, entry_id, content, modified_by, modified_at, summary)
                           VALUES (?, ?, ?, ?, ?, ?)''',
                        (edit_id, entry_id, content, modified_by, now, summary))
            
            conn.commit()
            
            response = {
                'id': entry_id,
                'title': entry['title'],
                'content': content,
                'lastModifiedBy': modified_by,
                'lastModifiedAt': now
            }
            
            return jsonify(response), 200
            
        except Exception as e:
            conn.rollback()
            abort(500, description=str(e))
        finally:
            conn.close()

@app.route('/entries/<entry_id>/edits')
def entry_edits(entry_id):
    # Sanitize entry_id
    entry_id = sanitize_input(entry_id)
    
    conn = get_db_connection()
    
    # Check if entry exists
    entry = conn.execute('SELECT title FROM entries WHERE id = ?', (entry_id,)).fetchone()
    if not entry:
        conn.close()
        abort(404, description="Entry not found")
    
    # Get all edits
    edits = conn.execute('''SELECT * FROM edits 
                           WHERE entry_id = ? 
                           ORDER BY modified_at DESC''', 
                        (entry_id,)).fetchall()
    conn.close()
    
    # Process edits and create diffs
    edits_list = []
    previous_content = ""
    
    for i in range(len(edits) - 1, -1, -1):
        edit = edits[i]
        current_content = edit['content']
        
        # Create diff
        diff_lines = list(difflib.unified_diff(
            previous_content.splitlines(keepends=True),
            current_content.splitlines(keepends=True),
            lineterm='',
            n=3
        ))
        
        # Format diff for HTML
        diff_html = ""
        for line in diff_lines[2:]:  # Skip the header lines
            if line.startswith('+'):
                diff_html += f'<span class="added">{html.escape(line)}</span>\n'
            elif line.startswith('-'):
                diff_html += f'<span class="removed">{html.escape(line)}</span>\n'
            else:
                diff_html += html.escape(line) + '\n'
        
        edits_list.append({
            'modified_at': edit['modified_at'],
            'modified_by': edit['modified_by'],
            'summary': edit['summary'],
            'diff': diff_html if diff_html else "No changes"
        })
        
        previous_content = current_content
    
    # Reverse to show newest first
    edits_list.reverse()
    
    return render_template_string(EDITS_HISTORY_TEMPLATE,
                                entry_id=entry_id,
                                title=entry['title'],
                                edits=edits_list)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)