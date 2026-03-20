import sqlite3
import json
from datetime import datetime
from difflib import unified_diff
from flask import Flask, render_template_string, request, jsonify
import os

app = Flask(__name__)
DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    if not os.path.exists(DATABASE):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE entries (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                lastModifiedBy TEXT NOT NULL,
                lastModifiedAt TEXT NOT NULL
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE edits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entryId TEXT NOT NULL,
                content TEXT NOT NULL,
                modifiedBy TEXT NOT NULL,
                modifiedAt TEXT NOT NULL,
                summary TEXT,
                FOREIGN KEY (entryId) REFERENCES entries(id)
            )
        ''')
        
        conn.commit()
        conn.close()

def generate_entry_id(title):
    return title.lower().replace(' ', '_').replace('-', '_')

def get_diff(old_content, new_content):
    old_lines = old_content.split('\n')
    new_lines = new_content.split('\n')
    diff = unified_diff(old_lines, new_lines, lineterm='')
    return '\n'.join(diff)

@app.route('/entries', methods=['GET'])
def list_entries():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, title FROM entries ORDER BY title')
    entries = cursor.fetchall()
    conn.close()
    
    html = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Wiki - All Entries</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; }
            ul { list-style-type: none; padding: 0; }
            li { margin: 10px 0; }
            a { color: #0066cc; text-decoration: none; }
            a:hover { text-decoration: underline; }
            .new-entry { margin-top: 20px; }
            button { padding: 10px 20px; background-color: #0066cc; color: white; border: none; cursor: pointer; }
            button:hover { background-color: #0052a3; }
        </style>
    </head>
    <body>
        <h1>Wiki Entries</h1>
        <ul>
    '''
    
    for entry in entries:
        html += f'<li><a href="/entries/{entry["id"]}">{entry["title"]}</a></li>'
    
    html += '''
        </ul>
        <div class="new-entry">
            <h2>Create New Entry</h2>
            <form id="newEntryForm">
                <div>
                    <label for="title">Title:</label><br>
                    <input type="text" id="title" name="title" required style="width: 300px; padding: 5px;">
                </div>
                <div style="margin-top: 10px;">
                    <label for="content">Content:</label><br>
                    <textarea id="content" name="content" required style="width: 500px; height: 200px; padding: 5px;"></textarea>
                </div>
                <div style="margin-top: 10px;">
                    <label for="createdBy">Author:</label><br>
                    <input type="text" id="createdBy" name="createdBy" required style="width: 300px; padding: 5px;">
                </div>
                <button type="submit" style="margin-top: 10px;">Create Entry</button>
            </form>
        </div>
        <script>
            document.getElementById('newEntryForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const data = {
                    title: document.getElementById('title').value,
                    content: document.getElementById('content').value,
                    createdBy: document.getElementById('createdBy').value
                };
                const response = await fetch('/entries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (response.ok) {
                    alert('Entry created successfully!');
                    window.location.reload();
                } else {
                    alert('Error creating entry');
                }
            });
        </script>
    </body>
    </html>
    '''
    
    return html, 200, {'Content-Type': 'text/html'}

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    entry_id = generate_entry_id(data['title'])
    now = datetime.utcnow().isoformat() + 'Z'
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute('''
            INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, data['title'], data['content'], data['createdBy'], now))
        
        cursor.execute('''
            INSERT INTO edits (entryId, content, modifiedBy, modifiedAt, summary)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, data['content'], data['createdBy'], now, 'Initial creation'))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': entry_id,
            'title': data['title'],
            'content': data['content'],
            'lastModifiedBy': data['createdBy'],
            'lastModifiedAt': now
        }), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Entry already exists'}), 400

@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = cursor.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    cursor.execute('SELECT DISTINCT modifiedBy FROM edits WHERE entryId = ? ORDER BY modifiedBy', (entry_id,))
    contributors = [row[0] for row in cursor.fetchall()]
    conn.close()
    
    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Wiki - {entry['title']}</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 20px; }}
            h1 {{ color: #333; }}
            .meta {{ color: #666; font-size: 0.9em; margin: 10px 0; }}
            .content {{ margin: 20px 0; line-height: 1.6; }}
            .contributors {{ margin: 10px 0; }}
            a {{ color: #0066cc; text-decoration: none; }}
            a:hover {{ text-decoration: underline; }}
            button {{ padding: 10px 20px; background-color: #0066cc; color: white; border: none; cursor: pointer; margin: 5px; }}
            button:hover {{ background-color: #0052a3; }}
            textarea {{ width: 500px; height: 200px; padding: 5px; }}
            input {{ padding: 5px; width: 300px; }}
        </style>
    </head>
    <body>
        <a href="/entries">← Back to entries</a>
        <h1>{entry['title']}</h1>
        <div class="meta">
            <p>Last modified by: <strong>{entry['lastModifiedBy']}</strong> on {entry['lastModifiedAt']}</p>
            <div class="contributors">
                <strong>Contributors:</strong> {', '.join(contributors)}
            </div>
        </div>
        <div class="content">
            {entry['content'].replace(chr(10), '<br>')}
        </div>
        <div>
            <button onclick="document.getElementById('editForm').style.display='block'">Edit Entry</button>
            <a href="/entries/{entry_id}/edits"><button type="button">View History</button></a>
        </div>
        <div id="editForm" style="display:none; margin-top: 20px; border: 1px solid #ccc; padding: 20px;">
            <h2>Edit Entry</h2>
            <form id="updateForm">
                <div>
                    <label for="content">Content:</label><br>
                    <textarea id="content" name="content" required>{entry['content']}</textarea>
                </div>
                <div style="margin-top: 10px;">
                    <label for="modifiedBy">Author:</label><br>
                    <input type="text" id="modifiedBy" name="modifiedBy" required>
                </div>
                <div style="margin-top: 10px;">
                    <label for="summary">Edit Summary:</label><br>
                    <input type="text" id="summary" name="summary" placeholder="Describe your changes">
                </div>
                <button type="submit" style="margin-top: 10px;">Save Changes</button>
                <button type="button" onclick="document.getElementById('editForm').style.display='none'" style="margin-top: 10px; background-color: #999;">Cancel</button>
            </form>
        </div>
        <script>
            document.getElementById('updateForm').addEventListener('submit', async (e) => {{
                e.preventDefault();
                const data = {{
                    content: document.getElementById('content').value,
                    modifiedBy: document.getElementById('modifiedBy').value,
                    summary: document.getElementById('summary').value
                }};
                const response = await fetch('/entries/{entry_id}', {{
                    method: 'PUT',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(data)
                }});
                if (response.ok) {{
                    alert('Entry updated successfully!');
                    window.location.reload();
                }} else {{
                    alert('Error updating entry');
                }}
            }});
        </script>
    </body>
    </html>
    '''
    
    return html, 200, {'Content-Type': 'text/html'}

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    data = request.get_json()
    
    if not data or 'content' not in data or 'modifiedBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = cursor.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    now = datetime.utcnow().isoformat() + 'Z'
    
    cursor.execute('''
        UPDATE entries
        SET content = ?, lastModifiedBy = ?, lastModifiedAt = ?
        WHERE id = ?
    ''', (data['content'], data['modifiedBy'], now, entry_id))
    
    cursor.execute('''
        INSERT INTO edits (entryId, content, modifiedBy, modifiedAt, summary)
        VALUES (?, ?, ?, ?, ?)
    ''', (entry_id, data['content'], data['modifiedBy'], now, data.get('summary', '')))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': entry_id,
        'title': entry['title'],
        'content': data['content'],
        'lastModifiedBy': data['modifiedBy'],
        'lastModifiedAt': now
    }), 200

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = cursor.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    cursor.execute('SELECT * FROM edits WHERE entryId = ? ORDER BY modifiedAt DESC', (entry_id,))
    edits = cursor.fetchall()
    conn.close()
    
    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Wiki - {entry['title']} - Edit History</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 20px; }}
            h1 {{ color: #333; }}
            .edit {{ border: 1px solid #ddd; padding: 15px; margin: 15px 0; background-color: #f9f9f9; }}
            .edit-meta {{ color: #666; font-size: 0.9em; margin-bottom: 10px; }}
            .diff {{ background-color: #f0f0f0; padding: 10px; margin: 10px 0; font-family: monospace; white-space: pre-wrap; word-wrap: break-word; }}
            .diff-add {{ color: green; }}
            .diff-remove {{ color: red; }}
            a {{ color: #0066cc; text-decoration: none; }}
            a:hover {{ text-decoration: underline; }}
        </style>
    </head>
    <body>
        <a href="/entries/{entry_id}">← Back to entry</a>
        <h1>Edit History: {entry['title']}</h1>
    '''
    
    previous_content = None
    for i, edit in enumerate(edits):
        diff_html = ''
        if previous_content is not None:
            diff = get_diff(edit['content'], previous_content)
            if diff:
                diff_html = f'<div class="diff">{diff}</div>'
        
        summary = edit['summary'] if edit['summary'] else '(no summary)'
        html += f'''
        <div class="edit">
            <div class="edit-meta">
                <strong>Edit by {edit['modifiedBy']}</strong> on {edit['modifiedAt']}<br>
                Summary: {summary}
            </div>
            {diff_html}
        </div>
        '''
        
        previous_content = edit['content']
    
    html += '''
    </body>
    </html>
    '''
    
    return html, 200, {'Content-Type': 'text/html'}

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)