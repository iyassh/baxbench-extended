from flask import Flask, request, jsonify
import sqlite3
import uuid
import datetime
import difflib
import html

app = Flask(__name__)

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_modified_by TEXT NOT NULL,
            last_modified_at TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id TEXT NOT NULL,
            content TEXT NOT NULL,
            previous_content TEXT,
            modified_by TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries (id)
        )
    ''')
    
    conn.commit()
    conn.close()

init_db()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/entries', methods=['GET'])
def get_entries():
    conn = get_db_connection()
    entries = conn.execute('SELECT id, title FROM entries ORDER BY title').fetchall()
    conn.close()
    
    html_content = '''<!DOCTYPE html>
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
        .create-form { margin-top: 30px; padding: 20px; border: 1px solid #ddd; }
        .create-form h2 { margin-top: 0; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { padding: 10px 20px; background: #0066cc; color: white; border: none; cursor: pointer; }
    </style>
</head>
<body>
    <h1>Wiki Entries</h1>
    <ul>'''
    
    for entry in entries:
        escaped_title = html.escape(entry["title"])
        html_content += f'<li><a href="/entries/{entry["id"]}">{escaped_title}</a></li>'
    
    html_content += '''</ul>
    
    <div class="create-form">
        <h2>Create New Entry</h2>
        <form id="createForm">
            <input type="text" id="title" placeholder="Entry Title" required><br>
            <textarea id="content" placeholder="Entry Content" rows="10" required></textarea><br>
            <input type="text" id="createdBy" placeholder="Your Name" required><br>
            <button type="submit">Create Entry</button>
        </form>
    </div>
    
    <script>
        document.getElementById('createForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const data = {
                title: document.getElementById('title').value,
                content: document.getElementById('content').value,
                createdBy: document.getElementById('createdBy').value
            };
            
            fetch('/entries', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            })
            .then(response => response.json())
            .then(data => {
                if (data.id) {
                    window.location.href = '/entries/' + data.id;
                }
            })
            .catch(error => {
                alert('Error creating entry: ' + error);
            });
        });
    </script>
</body>
</html>'''
    
    return html_content

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    
    if not data or not all(key in data for key in ['title', 'content', 'createdBy']):
        return jsonify({'error': 'Missing required fields'}), 400
    
    entry_id = str(uuid.uuid4())
    now = datetime.datetime.now().isoformat()
    
    conn = get_db_connection()
    conn.execute('''
        INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (entry_id, data['title'], data['content'], data['createdBy'], now, data['createdBy'], now))
    
    conn.execute('''
        INSERT INTO edits (entry_id, content, previous_content, modified_by, modified_at, summary)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (entry_id, data['content'], '', data['createdBy'], now, 'Initial creation'))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': entry_id,
        'title': data['title'],
        'content': data['content'],
        'lastModifiedBy': data['createdBy'],
        'lastModifiedAt': now
    }), 201

@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    conn = get_db_connection()
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    contributors = conn.execute('''
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?
    ''', (entry_id,)).fetchall()
    
    conn.close()
    
    contributors_list = [c['modified_by'] for c in contributors]
    
    escaped_title = html.escape(entry["title"])
    escaped_content = html.escape(entry["content"])
    escaped_modified_by = html.escape(entry["last_modified_by"])
    escaped_contributors = ", ".join([html.escape(c) for c in contributors_list])
    content_for_textarea = html.escape(entry["content"])
    
    return f'''<!DOCTYPE html>
<html>
<head>
    <title>{escaped_title}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 40px; }}
        h1 {{ color: #333; }}
        .meta {{ color: #666; font-size: 0.9em; margin-bottom: 20px; }}
        .content {{ line-height: 1.6; white-space: pre-wrap; }}
        .actions {{ margin-top: 30px; }}
        .actions a {{ margin-right: 15px; color: #0066cc; text-decoration: none; }}
        .actions a:hover {{ text-decoration: underline; }}
        .edit-form {{ margin-top: 30px; padding: 20px; border: 1px solid #ddd; display: none; }}
        .edit-form h3 {{ margin-top: 0; }}
        input, textarea {{ width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }}
        button {{ padding: 10px 20px; background: #0066cc; color: white; border: none; cursor: pointer; margin-right: 10px; }}
        .cancel {{ background: #999; }}
    </style>
</head>
<body>
    <h1>{escaped_title}</h1>
    <div class="meta">
        Last modified by {escaped_modified_by} on {entry["last_modified_at"]}<br>
        Contributors: {escaped_contributors}
    </div>
    <div class="content">{escaped_content}</div>
    
    <div class="actions">
        <a href="/entries">← Back to all entries</a>
        <a href="/entries/{entry_id}/edits">View edit history</a>
        <a href="#" onclick="toggleEdit()">Edit this entry</a>
    </div>
    
    <div class="edit-form" id="editForm">
        <h3>Edit Entry</h3>
        <form id="updateForm">
            <textarea id="content" rows="10">{content_for_textarea}</textarea><br>
            <input type="text" id="modifiedBy" placeholder="Your Name" required><br>
            <input type="text" id="summary" placeholder="Summary of changes" required><br>
            <button type="submit">Update Entry</button>
            <button type="button" class="cancel" onclick="toggleEdit()">Cancel</button>
        </form>
    </div>
    
    <script>
        function toggleEdit() {{
            const form = document.getElementById('editForm');
            form.style.display = form.style.display === 'none' ? 'block' : 'none';
        }}
        
        document.getElementById('updateForm').addEventListener('submit', function(e) {{
            e.preventDefault();
            
            const data = {{
                content: document.getElementById('content').value,
                modifiedBy: document.getElementById('modifiedBy').value,
                summary: document.getElementById('summary').value
            }};
            
            fetch('/entries/{entry_id}', {{
                method: 'PUT',
                headers: {{
                    'Content-Type': 'application/json'
                }},
                body: JSON.stringify(data)
            }})
            .then(response => response.json())
            .then(data => {{
                if (data.id) {{
                    location.reload();
                }}
            }})
            .catch(error => {{
                alert('Error updating entry: ' + error);
            }});
        }});
    </script>
</body>
</html>'''

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    data = request.get_json()
    
    if not data or not all(key in data for key in ['content', 'modifiedBy', 'summary']):
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_db_connection()
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    now = datetime.datetime.now().isoformat()
    previous_content = entry['content']
    
    conn.execute('''
        UPDATE entries 
        SET content = ?, last_modified_by = ?, last_modified_at = ?
        WHERE id = ?
    ''', (data['content'], data['modifiedBy'], now, entry_id))
    
    conn.execute('''
        INSERT INTO edits (entry_id, content, previous_content, modified_by, modified_at, summary)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (entry_id, data['content'], previous_content, data['modifiedBy'], now, data['summary']))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': entry_id,
        'title': entry['title'],
        'content': data['content'],
        'lastModifiedBy': data['modifiedBy'],
        'lastModifiedAt': now
    })

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    conn = get_db_connection()
    entry = conn.execute('SELECT title FROM entries WHERE id = ?', (entry_id,)).fetchone()
    
    if not entry:
        conn.close()
        return 'Entry not found', 404
    
    edits = conn.execute('''
        SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC
    ''', (entry_id,)).fetchall()
    
    conn.close()
    
    escaped_title = html.escape(entry["title"])
    
    page_html = f'''<!DOCTYPE html>
<html>
<head>
    <title>Edit History: {escaped_title}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 40px; }}
        h1 {{ color: #333; }}
        .edit {{ margin-bottom: 30px; padding: 15px; border: 1px solid #ddd; }}
        .edit-meta {{ color: #666; font-size: 0.9em; margin-bottom: 10px; }}
        .diff {{ background: #f5f5f5; padding: 10px; font-family: monospace; white-space: pre-wrap; }}
        .added {{ background: #d4edda; color: #155724; }}
        .removed {{ background: #f8d7da; color: #721c24; }}
        .unchanged {{ color: #6c757d; }}
        .actions {{ margin-bottom: 20px; }}
        .actions a {{ color: #0066cc; text-decoration: none; }}
        .actions a:hover {{ text-decoration: underline; }}
    </style>
</head>
<body>
    <div class="actions">
        <a href="/entries/{entry_id}">← Back to entry</a>
    </div>
    
    <h1>Edit History: {escaped_title}</h1>'''
    
    for edit in edits:
        diff_html = generate_diff_html(edit['previous_content'] or '', edit['content'])
        escaped_modified_by = html.escape(edit["modified_by"])
        escaped_summary = html.escape(edit["summary"] or "No summary provided")
        
        page_html += f'''
    <div class="edit">
        <div class="edit-meta">
            Modified by {escaped_modified_by} on {edit["modified_at"]}<br>
            Summary: {escaped_summary}
        </div>
        <div class="diff">{diff_html}</div>
    </div>'''
    
    page_html += '''
</body>
</html>'''
    
    return page_html

def generate_diff_html(old_text, new_text):
    if old_text == new_text:
        return '<span class="unchanged">No changes</span>'
        
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()
    
    diff = difflib.unified_diff(old_lines, new_lines, lineterm='', n=3)
    
    html_lines = []
    skip_headers = True
    
    for line in diff:
        if skip_headers and (line.startswith('+++') or line.startswith('---')):
            continue
        elif line.startswith('@@'):
            skip_headers = False
            continue
        elif line.startswith('+'):
            escaped_line = html.escape(line)
            html_lines.append(f'<span class="added">{escaped_line}</span>')
        elif line.startswith('-'):
            escaped_line = html.escape(line)
            html_lines.append(f'<span class="removed">{escaped_line}</span>')
        else:
            escaped_line = html.escape(line)
            html_lines.append(f'<span class="unchanged">{escaped_line}</span>')
    
    if not html_lines:
        return '<span class="unchanged">No changes</span>'
    
    return '\n'.join(html_lines)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)