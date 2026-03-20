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
        body { font-family: Arial, sans-serif; margin: 40px; }
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

ENTRY_DETAIL_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .content { margin: 20px 0; line-height: 1.6; }
        .metadata { color: #666; font-size: 0.9em; margin: 20px 0; }
        .contributors { margin-top: 20px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>{{ title }}</h1>
    <div class="content">{{ content }}</div>
    <div class="metadata">
        <p>Last edited: {{ last_modified_at }} by {{ last_modified_by }}</p>
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
    <p><a href="/entries">Back to all entries</a></p>
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
        .edit-header { background-color: #f5f5f5; margin: -15px -15px 15px -15px; padding: 10px 15px; }
        .diff { font-family: monospace; background-color: #f9f9f9; padding: 10px; margin: 10px 0; }
        .diff-add { background-color: #e6ffed; color: #24292e; }
        .diff-remove { background-color: #ffeef0; color: #24292e; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History: {{ title }}</h1>
    {% for edit in edits %}
    <div class="edit">
        <div class="edit-header">
            <strong>{{ edit.modified_by }}</strong> - {{ edit.modified_at }}
            {% if edit.summary %}
            <br>Summary: {{ edit.summary }}
            {% endif %}
        </div>
        <div class="diff">
            {% for line in edit.diff %}
                {% if line.startswith('+') and not line.startswith('+++') %}
                    <div class="diff-add">{{ line }}</div>
                {% elif line.startswith('-') and not line.startswith('---') %}
                    <div class="diff-remove">{{ line }}</div>
                {% else %}
                    <div>{{ line }}</div>
                {% endif %}
            {% endfor %}
        </div>
    </div>
    {% endfor %}
    <p><a href="/entries/{{ entry_id }}">Back to entry</a></p>
    <p><a href="/entries">Back to all entries</a></p>
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

@app.route('/entries', methods=['GET'])
def get_entries():
    conn = get_db_connection()
    entries = conn.execute('SELECT id, title FROM entries ORDER BY title').fetchall()
    conn.close()
    
    entries_list = [dict(entry) for entry in entries]
    return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries_list)

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    entry_id = str(uuid.uuid4())
    title = sanitize_input(data['title'])
    content = sanitize_input(data['content'])
    created_by = sanitize_input(data['createdBy'])
    created_at = datetime.now().isoformat()
    
    conn = get_db_connection()
    try:
        conn.execute('''INSERT INTO entries 
                        (id, title, content, created_by, created_at, last_modified_by, last_modified_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)''',
                     (entry_id, title, content, created_by, created_at, created_by, created_at))
        
        # Add initial edit record
        edit_id = str(uuid.uuid4())
        conn.execute('''INSERT INTO edits 
                        (id, entry_id, content, modified_by, modified_at, summary)
                        VALUES (?, ?, ?, ?, ?, ?)''',
                     (edit_id, entry_id, content, created_by, created_at, 'Initial creation'))
        
        conn.commit()
    except sqlite3.Error as e:
        conn.close()
        return jsonify({'error': str(e)}), 500
    
    conn.close()
    
    return jsonify({
        'id': entry_id,
        'title': title,
        'content': content,
        'lastModifiedBy': created_by,
        'lastModifiedAt': created_at
    }), 201

@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    entry_id = sanitize_input(entry_id)
    
    conn = get_db_connection()
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    
    if not entry:
        conn.close()
        abort(404)
    
    # Get all contributors
    contributors = conn.execute('''SELECT DISTINCT modified_by FROM edits 
                                   WHERE entry_id = ? 
                                   ORDER BY modified_by''', (entry_id,)).fetchall()
    conn.close()
    
    contributors_list = [c['modified_by'] for c in contributors]
    
    return render_template_string(ENTRY_DETAIL_TEMPLATE,
                                 entry_id=entry['id'],
                                 title=entry['title'],
                                 content=entry['content'],
                                 last_modified_at=entry['last_modified_at'],
                                 last_modified_by=entry['last_modified_by'],
                                 contributors=contributors_list)

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    entry_id = sanitize_input(entry_id)
    data = request.get_json()
    
    if not data or 'content' not in data or 'modifiedBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db_connection()
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    new_content = sanitize_input(data['content'])
    modified_by = sanitize_input(data['modifiedBy'])
    summary = sanitize_input(data.get('summary', ''))
    modified_at = datetime.now().isoformat()
    
    try:
        # Update entry
        conn.execute('''UPDATE entries 
                        SET content = ?, last_modified_by = ?, last_modified_at = ?
                        WHERE id = ?''',
                     (new_content, modified_by, modified_at, entry_id))
        
        # Add edit record
        edit_id = str(uuid.uuid4())
        conn.execute('''INSERT INTO edits 
                        (id, entry_id, content, modified_by, modified_at, summary)
                        VALUES (?, ?, ?, ?, ?, ?)''',
                     (edit_id, entry_id, new_content, modified_by, modified_at, summary))
        
        conn.commit()
    except sqlite3.Error as e:
        conn.close()
        return jsonify({'error': str(e)}), 500
    
    conn.close()
    
    return jsonify({
        'id': entry_id,
        'title': entry['title'],
        'content': new_content,
        'lastModifiedBy': modified_by,
        'lastModifiedAt': modified_at
    }), 200

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_entry_edits(entry_id):
    entry_id = sanitize_input(entry_id)
    
    conn = get_db_connection()
    entry = conn.execute('SELECT title FROM entries WHERE id = ?', (entry_id,)).fetchone()
    
    if not entry:
        conn.close()
        abort(404)
    
    edits = conn.execute('''SELECT * FROM edits 
                            WHERE entry_id = ? 
                            ORDER BY modified_at DESC''', (entry_id,)).fetchall()
    conn.close()
    
    edits_with_diff = []
    previous_content = ""
    
    for i in range(len(edits) - 1, -1, -1):
        edit = edits[i]
        current_content = edit['content']
        
        # Generate diff
        diff = list(difflib.unified_diff(
            previous_content.splitlines(keepends=True),
            current_content.splitlines(keepends=True),
            lineterm='',
            n=3
        ))
        
        edits_with_diff.append({
            'modified_by': edit['modified_by'],
            'modified_at': edit['modified_at'],
            'summary': edit['summary'],
            'diff': diff if diff else ['No changes']
        })
        
        previous_content = current_content
    
    edits_with_diff.reverse()
    
    return render_template_string(EDITS_HISTORY_TEMPLATE,
                                 entry_id=entry_id,
                                 title=entry['title'],
                                 edits=edits_with_diff)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)