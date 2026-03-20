from flask import Flask, request, jsonify, render_template_string
import sqlite3
from datetime import datetime
import difflib
import html

app = Flask(__name__)

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create entries table
    c.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL
        )
    ''')
    
    # Create edits table (stores all versions of content)
    c.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Helper function to get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# GET /entries - List all entries
@app.route('/entries', methods=['GET'])
def get_entries():
    conn = get_db()
    c = conn.cursor()
    
    # Get all entries with their latest edit info
    c.execute('''
        SELECT 
            e.id, 
            e.title, 
            (SELECT modified_at FROM edits WHERE entry_id = e.id ORDER BY id DESC LIMIT 1) as modified_at,
            (SELECT modified_by FROM edits WHERE entry_id = e.id ORDER BY id DESC LIMIT 1) as modified_by
        FROM entries e
        ORDER BY e.id
    ''')
    
    entries = c.fetchall()
    conn.close()
    
    html_template = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Wiki Entries</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            h1 { color: #333; }
            ul { list-style-type: none; padding: 0; }
            li { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }
            a { color: #0066cc; text-decoration: none; }
            a:hover { text-decoration: underline; }
            .meta { color: #666; font-size: 0.9em; }
        </style>
    </head>
    <body>
        <h1>Wiki Entries</h1>
        <ul>
        {% for entry in entries %}
            <li>
                <a href="/entries/{{ entry.id }}">{{ entry.title }}</a>
                {% if entry.modified_at %}
                <div class="meta">Last modified: {{ entry.modified_at }} by {{ entry.modified_by }}</div>
                {% endif %}
            </li>
        {% endfor %}
        </ul>
    </body>
    </html>
    '''
    
    return render_template_string(html_template, entries=entries)

# POST /entries - Create a new entry
@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    title = data['title']
    content = data['content']
    created_by = data['createdBy']
    created_at = datetime.utcnow().isoformat()
    
    conn = get_db()
    c = conn.cursor()
    
    # Insert into entries table
    c.execute(
        'INSERT INTO entries (title, created_at, created_by) VALUES (?, ?, ?)',
        (title, created_at, created_by)
    )
    entry_id = c.lastrowid
    
    # Insert initial content into edits table
    c.execute(
        'INSERT INTO edits (entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?)',
        (entry_id, content, created_by, created_at, 'Initial creation')
    )
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': str(entry_id),
        'title': title,
        'content': content,
        'lastModifiedBy': created_by,
        'lastModifiedAt': created_at
    }), 201

# GET /entries/{entryId} - Get a specific entry
@app.route('/entries/<int:entry_id>', methods=['GET'])
def get_entry(entry_id):
    conn = get_db()
    c = conn.cursor()
    
    # Get entry
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    # Get latest content
    c.execute(
        'SELECT content, modified_by, modified_at FROM edits WHERE entry_id = ? ORDER BY id DESC LIMIT 1',
        (entry_id,)
    )
    latest_edit = c.fetchone()
    
    # Get all contributors
    c.execute(
        'SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by',
        (entry_id,)
    )
    contributors = [row['modified_by'] for row in c.fetchall()]
    
    conn.close()
    
    html_template = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>{{ title }}</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            h1 { color: #333; }
            .meta { color: #666; font-size: 0.9em; margin: 20px 0; }
            .content { line-height: 1.6; white-space: pre-wrap; }
            .nav { margin: 20px 0; }
            a { color: #0066cc; text-decoration: none; }
            a:hover { text-decoration: underline; }
        </style>
    </head>
    <body>
        <div class="nav">
            <a href="/entries">← Back to all entries</a> | 
            <a href="/entries/{{ entry_id }}/edits">View edit history</a>
        </div>
        <h1>{{ title }}</h1>
        <div class="meta">
            Last modified: {{ modified_at }} by {{ modified_by }}<br>
            Contributors: {{ contributors }}
        </div>
        <div class="content">{{ content }}</div>
    </body>
    </html>
    '''
    
    return render_template_string(
        html_template,
        entry_id=entry_id,
        title=entry['title'],
        content=latest_edit['content'],
        modified_by=latest_edit['modified_by'],
        modified_at=latest_edit['modified_at'],
        contributors=', '.join(contributors)
    )

# PUT /entries/{entryId} - Update an entry
@app.route('/entries/<int:entry_id>', methods=['PUT'])
def update_entry(entry_id):
    data = request.get_json()
    
    if not data or 'content' not in data or 'modifiedBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    content = data['content']
    modified_by = data['modifiedBy']
    summary = data.get('summary', '')
    modified_at = datetime.utcnow().isoformat()
    
    conn = get_db()
    c = conn.cursor()
    
    # Check if entry exists
    c.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    # Insert new edit
    c.execute(
        'INSERT INTO edits (entry_id, content, modified_by, modified_at, summary) VALUES (?, ?, ?, ?, ?)',
        (entry_id, content, modified_by, modified_at, summary)
    )
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': str(entry_id),
        'title': entry['title'],
        'content': content,
        'lastModifiedBy': modified_by,
        'lastModifiedAt': modified_at
    })

# GET /entries/{entryId}/edits - View edit history
@app.route('/entries/<int:entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    conn = get_db()
    c = conn.cursor()
    
    # Check if entry exists
    c.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    # Get all edits
    c.execute(
        'SELECT id, content, modified_by, modified_at, summary FROM edits WHERE entry_id = ? ORDER BY id DESC',
        (entry_id,)
    )
    edits = c.fetchall()
    
    conn.close()
    
    # Generate diffs
    edits_with_diffs = []
    for i, edit in enumerate(edits):
        diff_html = ''
        if i < len(edits) - 1:
            # Compare with previous edit
            old_content = edits[i + 1]['content'].splitlines(keepends=True)
            new_content = edit['content'].splitlines(keepends=True)
            
            diff = difflib.unified_diff(old_content, new_content, lineterm='')
            diff_lines = list(diff)
            
            if diff_lines:
                diff_html = '<pre style="background: #f5f5f5; padding: 10px; overflow-x: auto;">'
                for line in diff_lines:
                    line_escaped = html.escape(line)
                    if line.startswith('+') and not line.startswith('+++'):
                        diff_html += f'<span style="color: green;">{line_escaped}</span>\n'
                    elif line.startswith('-') and not line.startswith('---'):
                        diff_html += f'<span style="color: red;">{line_escaped}</span>\n'
                    else:
                        diff_html += f'{line_escaped}\n'
                diff_html += '</pre>'
        else:
            diff_html = '<p><em>Initial version</em></p>'
        
        edits_with_diffs.append({
            'id': edit['id'],
            'content': edit['content'],
            'modified_by': edit['modified_by'],
            'modified_at': edit['modified_at'],
            'summary': edit['summary'] or '',
            'diff_html': diff_html
        })
    
    html_template = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Edit History - {{ title }}</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; }
            h1 { color: #333; }
            .nav { margin: 20px 0; }
            a { color: #0066cc; text-decoration: none; }
            a:hover { text-decoration: underline; }
            .edit { margin: 20px 0; padding: 15px; background: #fff; border: 1px solid #ddd; border-radius: 5px; }
            .edit-header { font-weight: bold; margin-bottom: 10px; }
            .summary { color: #666; font-style: italic; margin: 5px 0; }
        </style>
    </head>
    <body>
        <div class="nav">
            <a href="/entries">← Back to all entries</a> | 
            <a href="/entries/{{ entry_id }}">← Back to entry</a>
        </div>
        <h1>Edit History: {{ title }}</h1>
        {% for edit in edits %}
        <div class="edit">
            <div class="edit-header">
                Edit by {{ edit.modified_by }} at {{ edit.modified_at }}
            </div>
            {% if edit.summary %}
            <div class="summary">Summary: {{ edit.summary }}</div>
            {% endif %}
            {{ edit.diff_html|safe }}
        </div>
        {% endfor %}
    </body>
    </html>
    '''
    
    return render_template_string(
        html_template,
        entry_id=entry_id,
        title=entry['title'],
        edits=edits_with_diffs
    )

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)