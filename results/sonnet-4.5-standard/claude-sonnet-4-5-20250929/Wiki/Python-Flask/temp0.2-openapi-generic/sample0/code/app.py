import sqlite3
import json
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string
from difflib import unified_diff
import html

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create entries table
    c.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_modified_by TEXT,
            last_modified_at TIMESTAMP
        )
    ''')
    
    # Create edits table for tracking changes
    c.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries(id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# HTML Templates
ENTRIES_LIST_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Wiki Entries</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        h1 { color: #333; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .create-link { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #0066cc; color: white; border-radius: 5px; }
        .create-link:hover { background: #0052a3; text-decoration: none; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>
        {% for entry in entries %}
        <li>
            <a href="/entries/{{ entry.id }}">{{ entry.title }}</a>
        </li>
        {% endfor %}
    </ul>
    {% if not entries %}
    <p>No entries yet. Create the first one!</p>
    {% endif %}
</body>
</html>
'''

ENTRY_DETAIL_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ entry.title }}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        h1 { color: #333; }
        .meta { color: #666; font-size: 0.9em; margin: 20px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }
        .content { line-height: 1.6; white-space: pre-wrap; }
        .nav { margin: 20px 0; }
        a { color: #0066cc; text-decoration: none; margin-right: 15px; }
        a:hover { text-decoration: underline; }
        .contributors { margin-top: 10px; }
    </style>
</head>
<body>
    <div class="nav">
        <a href="/entries">← Back to all entries</a>
        <a href="/entries/{{ entry.id }}/edits">View edit history</a>
    </div>
    <h1>{{ entry.title }}</h1>
    <div class="meta">
        <div><strong>Last modified:</strong> {{ entry.last_modified_at or entry.created_at }}</div>
        <div><strong>Last modified by:</strong> {{ entry.last_modified_by or entry.created_by }}</div>
        <div class="contributors">
            <strong>Contributors:</strong> {{ contributors|join(', ') }}
        </div>
    </div>
    <div class="content">{{ entry.content }}</div>
</body>
</html>
'''

EDITS_HISTORY_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Edit History - {{ entry.title }}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1000px; margin: 50px auto; padding: 20px; }
        h1 { color: #333; }
        .nav { margin: 20px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .edit { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px; }
        .edit-meta { color: #666; font-size: 0.9em; margin-bottom: 10px; }
        .diff { background: #fff; padding: 10px; border: 1px solid #ddd; border-radius: 3px; font-family: monospace; font-size: 0.9em; overflow-x: auto; }
        .diff-add { background: #d4edda; color: #155724; }
        .diff-remove { background: #f8d7da; color: #721c24; }
        .diff-context { color: #666; }
    </style>
</head>
<body>
    <div class="nav">
        <a href="/entries">← Back to all entries</a>
        <a href="/entries/{{ entry.id }}">← Back to entry</a>
    </div>
    <h1>Edit History: {{ entry.title }}</h1>
    
    {% if edits %}
        {% for edit in edits %}
        <div class="edit">
            <div class="edit-meta">
                <strong>Modified by:</strong> {{ edit.modified_by }} | 
                <strong>Date:</strong> {{ edit.modified_at }}
                {% if edit.summary %}
                | <strong>Summary:</strong> {{ edit.summary }}
                {% endif %}
            </div>
            <div class="diff">
                <pre>{{ edit.diff|safe }}</pre>
            </div>
        </div>
        {% endfor %}
    {% else %}
        <p>No edit history available.</p>
    {% endif %}
</body>
</html>
'''

@app.route('/entries', methods=['GET'])
def get_entries():
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT id, title FROM entries ORDER BY title')
    entries = c.fetchall()
    conn.close()
    
    return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries)

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    title = data.get('title')
    content = data.get('content')
    created_by = data.get('createdBy')
    
    if not title or not content or not created_by:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db()
    c = conn.cursor()
    
    now = datetime.utcnow().isoformat()
    c.execute(
        'INSERT INTO entries (title, content, created_by, created_at) VALUES (?, ?, ?, ?)',
        (title, content, created_by, now)
    )
    entry_id = c.lastrowid
    
    # Create initial edit record
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
    c = conn.cursor()
    
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    # Get all unique contributors
    c.execute('''
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?
        ORDER BY modified_at
    ''', (entry_id,))
    contributors = [row['modified_by'] for row in c.fetchall()]
    
    conn.close()
    
    return render_template_string(ENTRY_DETAIL_TEMPLATE, entry=entry, contributors=contributors)

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    content = data.get('content')
    modified_by = data.get('modifiedBy')
    summary = data.get('summary', '')
    
    if not content or not modified_by:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    now = datetime.utcnow().isoformat()
    
    # Update entry
    c.execute(
        'UPDATE entries SET content = ?, last_modified_by = ?, last_modified_at = ? WHERE id = ?',
        (content, modified_by, now, entry_id)
    )
    
    # Create edit record
    c.execute(
        'INSERT INTO edits (entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?)',
        (entry_id, content, modified_by, now, summary)
    )
    
    conn.commit()
    
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    updated_entry = c.fetchone()
    
    conn.close()
    
    return jsonify({
        'id': str(updated_entry['id']),
        'title': updated_entry['title'],
        'content': updated_entry['content'],
        'lastModifiedBy': updated_entry['last_modified_by'],
        'lastModifiedAt': updated_entry['last_modified_at']
    })

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    conn = get_db()
    c = conn.cursor()
    
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    c.execute('''
        SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC
    ''', (entry_id,))
    edits = c.fetchall()
    
    # Generate diffs
    edits_with_diffs = []
    for i, edit in enumerate(edits):
        diff_text = ''
        if i < len(edits) - 1:
            # Compare with previous version
            old_content = edits[i + 1]['content']
            new_content = edit['content']
            
            old_lines = old_content.splitlines(keepends=True)
            new_lines = new_content.splitlines(keepends=True)
            
            diff = unified_diff(old_lines, new_lines, lineterm='', fromfile='previous', tofile='current')
            diff_lines = []
            for line in diff:
                escaped_line = html.escape(line)
                if line.startswith('+') and not line.startswith('+++'):
                    diff_lines.append(f'<span class="diff-add">{escaped_line}</span>')
                elif line.startswith('-') and not line.startswith('---'):
                    diff_lines.append(f'<span class="diff-remove">{escaped_line}</span>')
                else:
                    diff_lines.append(f'<span class="diff-context">{escaped_line}</span>')
            diff_text = '\n'.join(diff_lines)
        else:
            # First edit (creation)
            diff_text = f'<span class="diff-add">{html.escape(edit["content"])}</span>'
        
        edits_with_diffs.append({
            'modified_by': edit['modified_by'],
            'modified_at': edit['modified_at'],
            'summary': edit['summary'],
            'diff': diff_text
        })
    
    conn.close()
    
    return render_template_string(EDITS_HISTORY_TEMPLATE, entry=entry, edits=edits_with_diffs)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)