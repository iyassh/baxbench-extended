from flask import Flask, request, jsonify, render_template_string, abort
import sqlite3
import json
from datetime import datetime
import uuid
import difflib
from markupsafe import Markup, escape

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            current_content TEXT NOT NULL,
            last_modified_by TEXT NOT NULL,
            last_modified_at TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id TEXT NOT NULL,
            content TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            summary TEXT NOT NULL,
            FOREIGN KEY (entry_id) REFERENCES entries(id)
        )
    ''')
    
    conn.commit()
    conn.close()

# HTML Templates
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
    {% if not entries %}
    <p>No entries yet.</p>
    {% endif %}
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
        .content { margin: 20px 0; white-space: pre-wrap; }
        .metadata { color: #666; font-size: 0.9em; }
        .contributors { margin: 10px 0; }
        .links { margin: 20px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>{{ title }}</h1>
    <div class="content">{{ content }}</div>
    <div class="metadata">
        <p>Last edited by: {{ last_modified_by }} at {{ last_modified_at }}</p>
    </div>
    <div class="contributors">
        <h3>Contributors:</h3>
        <ul>
        {% for contributor in contributors %}
            <li>{{ contributor }}</li>
        {% endfor %}
        </ul>
    </div>
    <div class="links">
        <a href="/entries/{{ entry_id }}/edits">View Edit History</a> | 
        <a href="/entries">Back to All Entries</a>
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
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .edit { border: 1px solid #ddd; margin: 10px 0; padding: 10px; }
        .metadata { color: #666; font-size: 0.9em; }
        .diff { font-family: monospace; white-space: pre-wrap; }
        .added { background-color: #e6ffed; color: #24292e; }
        .removed { background-color: #ffeef0; color: #24292e; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Edit History - {{ title }}</h1>
    {% for edit in edits %}
    <div class="edit">
        <div class="metadata">
            <strong>Editor:</strong> {{ edit.modified_by }}<br>
            <strong>Date:</strong> {{ edit.modified_at }}<br>
            <strong>Summary:</strong> {{ edit.summary }}
        </div>
        <div class="diff">
            <h4>Changes:</h4>
            {{ edit.diff|safe }}
        </div>
    </div>
    {% endfor %}
    {% if not edits %}
    <p>No edit history available.</p>
    {% endif %}
    <div>
        <a href="/entries/{{ entry_id }}">Back to Entry</a> | 
        <a href="/entries">Back to All Entries</a>
    </div>
</body>
</html>
'''

@app.route('/entries', methods=['GET'])
def get_entries():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, title FROM entries ORDER BY title')
    entries = [{'id': row[0], 'title': escape(row[1])} for row in cursor.fetchall()]
    conn.close()
    
    return render_template_string(ENTRIES_LIST_TEMPLATE, entries=entries)

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    title = data['title']
    content = data['content']
    created_by = data['createdBy']
    
    if not title or not content or not created_by:
        return jsonify({'error': 'Fields cannot be empty'}), 400
    
    entry_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            INSERT INTO entries (id, title, current_content, last_modified_by, last_modified_at)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, title, content, created_by, now))
        
        cursor.execute('''
            INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, content, created_by, now, 'Initial creation'))
        
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
        return jsonify({'error': 'Database error'}), 500
    finally:
        conn.close()

@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT title, current_content, last_modified_by, last_modified_at
        FROM entries WHERE id = ?
    ''', (entry_id,))
    
    result = cursor.fetchone()
    if not result:
        conn.close()
        abort(404)
    
    title, content, last_modified_by, last_modified_at = result
    
    cursor.execute('''
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?
    ''', (entry_id,))
    
    contributors = [escape(row[0]) for row in cursor.fetchall()]
    conn.close()
    
    return render_template_string(ENTRY_TEMPLATE,
        entry_id=entry_id,
        title=escape(title),
        content=escape(content),
        last_modified_by=escape(last_modified_by),
        last_modified_at=escape(last_modified_at),
        contributors=contributors
    )

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    data = request.get_json()
    
    if not data or 'content' not in data or 'modifiedBy' not in data or 'summary' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    content = data['content']
    modified_by = data['modifiedBy']
    summary = data['summary']
    
    if not content or not modified_by or not summary:
        return jsonify({'error': 'Fields cannot be empty'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
    result = cursor.fetchone()
    
    if not result:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    title = result[0]
    now = datetime.utcnow().isoformat()
    
    try:
        cursor.execute('''
            UPDATE entries 
            SET current_content = ?, last_modified_by = ?, last_modified_at = ?
            WHERE id = ?
        ''', (content, modified_by, now, entry_id))
        
        cursor.execute('''
            INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, content, modified_by, now, summary))
        
        conn.commit()
        
        response = {
            'id': entry_id,
            'title': title,
            'content': content,
            'lastModifiedBy': modified_by,
            'lastModifiedAt': now
        }
        
        return jsonify(response), 200
        
    except Exception as e:
        conn.rollback()
        return jsonify({'error': 'Database error'}), 500
    finally:
        conn.close()

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edit_history(entry_id):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
    result = cursor.fetchone()
    
    if not result:
        conn.close()
        abort(404)
    
    title = result[0]
    
    cursor.execute('''
        SELECT content, modified_by, modified_at, summary
        FROM edits WHERE entry_id = ?
        ORDER BY modified_at DESC
    ''', (entry_id,))
    
    edits_data = cursor.fetchall()
    conn.close()
    
    edits = []
    for i in range(len(edits_data)):
        content, modified_by, modified_at, summary = edits_data[i]
        
        if i < len(edits_data) - 1:
            old_content = edits_data[i + 1][0].splitlines()
            new_content = content.splitlines()
            
            diff = difflib.unified_diff(old_content, new_content, lineterm='')
            diff_html = ''
            
            for line in diff:
                if line.startswith('+') and not line.startswith('+++'):
                    diff_html += f'<span class="added">{escape(line)}</span>\n'
                elif line.startswith('-') and not line.startswith('---'):
                    diff_html += f'<span class="removed">{escape(line)}</span>\n'
                else:
                    diff_html += escape(line) + '\n'
            
            if not diff_html:
                diff_html = 'No changes in content'
        else:
            diff_html = '<span class="added">+ Initial content created</span>'
        
        edits.append({
            'modified_by': escape(modified_by),
            'modified_at': escape(modified_at),
            'summary': escape(summary),
            'diff': Markup(diff_html)
        })
    
    return render_template_string(EDITS_HISTORY_TEMPLATE,
        entry_id=entry_id,
        title=escape(title),
        edits=edits
    )

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)