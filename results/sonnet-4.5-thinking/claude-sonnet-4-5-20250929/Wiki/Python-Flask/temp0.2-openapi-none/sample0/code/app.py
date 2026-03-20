from flask import Flask, request, jsonify
from markupsafe import escape
import sqlite3
from datetime import datetime
import difflib

app = Flask(__name__)
DATABASE = 'db.sqlite3'

# Initialize database
def init_db():
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    
    # Create entries table
    c.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            last_modified_by TEXT NOT NULL,
            last_modified_at TEXT NOT NULL
        )
    ''')
    
    # Create edits table for history
    c.execute('''
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

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

# Helper function to generate entry ID from title
def generate_id(title):
    # Simple ID generation - replace non-alphanumeric characters
    return ''.join(c if c.isalnum() or c in '-_' else '_' for c in title.lower())

@app.route('/entries', methods=['GET'])
def list_entries():
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT id, title FROM entries ORDER BY title')
    entries = c.fetchall()
    conn.close()
    
    html = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Wiki Entries</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
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
    '''
    
    for entry in entries:
        html += f'<li><a href="/entries/{escape(entry["id"])}">{escape(entry["title"])}</a></li>'
    
    html += '''
        </ul>
    </body>
    </html>
    '''
    
    return html, 200, {'Content-Type': 'text/html'}

@app.route('/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    entry_id = generate_id(data['title'])
    created_at = datetime.utcnow().isoformat() + 'Z'
    
    conn = get_db()
    c = conn.cursor()
    
    # Check if entry already exists
    c.execute('SELECT id FROM entries WHERE id = ?', (entry_id,))
    if c.fetchone():
        conn.close()
        return jsonify({'error': 'Entry already exists'}), 400
    
    # Insert entry
    c.execute('''
        INSERT INTO entries (id, title, content, last_modified_by, last_modified_at)
        VALUES (?, ?, ?, ?, ?)
    ''', (entry_id, data['title'], data['content'], data['createdBy'], created_at))
    
    # Insert initial edit history
    c.execute('''
        INSERT INTO edits (entry_id, content, previous_content, modified_by, modified_at, summary)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (entry_id, data['content'], None, data['createdBy'], created_at, 'Initial creation'))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': entry_id,
        'title': data['title'],
        'content': data['content'],
        'lastModifiedBy': data['createdBy'],
        'lastModifiedAt': created_at
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
    
    # Get all contributors
    c.execute('''
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by
    ''', (entry_id,))
    contributors = [row['modified_by'] for row in c.fetchall()]
    conn.close()
    
    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>{escape(entry["title"])}</title>
        <style>
            body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }}
            h1 {{ color: #333; }}
            .meta {{ color: #666; font-size: 0.9em; margin: 20px 0; }}
            .content {{ line-height: 1.6; white-space: pre-wrap; }}
            a {{ color: #0066cc; text-decoration: none; }}
            a:hover {{ text-decoration: underline; }}
            .nav {{ margin: 20px 0; }}
        </style>
    </head>
    <body>
        <div class="nav">
            <a href="/entries">← Back to all entries</a> | 
            <a href="/entries/{escape(entry_id)}/edits">View edit history</a>
        </div>
        <h1>{escape(entry["title"])}</h1>
        <div class="meta">
            Last modified by {escape(entry["last_modified_by"])} on {escape(entry["last_modified_at"])}<br>
            Contributors: {escape(", ".join(contributors))}
        </div>
        <div class="content">{escape(entry["content"])}</div>
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
    c = conn.cursor()
    
    # Check if entry exists and get current content
    c.execute('SELECT * FROM entries WHERE id = ?', (entry_id,))
    entry = c.fetchone()
    
    if not entry:
        conn.close()
        return jsonify({'error': 'Entry not found'}), 404
    
    modified_at = datetime.utcnow().isoformat() + 'Z'
    previous_content = entry['content']
    summary = data.get('summary', '')
    
    # Update entry
    c.execute('''
        UPDATE entries 
        SET content = ?, last_modified_by = ?, last_modified_at = ?
        WHERE id = ?
    ''', (data['content'], data['modifiedBy'], modified_at, entry_id))
    
    # Insert edit history
    c.execute('''
        INSERT INTO edits (entry_id, content, previous_content, modified_by, modified_at, summary)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (entry_id, data['content'], previous_content, data['modifiedBy'], modified_at, summary))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': entry_id,
        'title': entry['title'],
        'content': data['content'],
        'lastModifiedBy': data['modifiedBy'],
        'lastModifiedAt': modified_at
    }), 200

@app.route('/entries/<entry_id>/edits', methods=['GET'])
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
    c.execute('''
        SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC
    ''', (entry_id,))
    edits = c.fetchall()
    conn.close()
    
    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Edit History - {escape(entry["title"])}</title>
        <style>
            body {{ font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }}
            h1 {{ color: #333; }}
            .edit {{ border: 1px solid #ddd; padding: 15px; margin: 15px 0; border-radius: 5px; }}
            .edit-meta {{ color: #666; font-size: 0.9em; margin-bottom: 10px; }}
            .diff {{ background-color: #f5f5f5; padding: 10px; border-radius: 3px; font-family: monospace; white-space: pre-wrap; font-size: 0.9em; }}
            .diff-line {{ margin: 2px 0; }}
            .added {{ background-color: #d4edda; }}
            .removed {{ background-color: #f8d7da; }}
            a {{ color: #0066cc; text-decoration: none; }}
            a:hover {{ text-decoration: underline; }}
            .nav {{ margin: 20px 0; }}
        </style>
    </head>
    <body>
        <div class="nav">
            <a href="/entries">← Back to all entries</a> | 
            <a href="/entries/{escape(entry_id)}">View current version</a>
        </div>
        <h1>Edit History - {escape(entry["title"])}</h1>
    '''
    
    for edit in edits:
        # Generate diff
        if edit['previous_content']:
            prev_lines = edit['previous_content'].splitlines()
            curr_lines = edit['content'].splitlines()
            diff = list(difflib.unified_diff(prev_lines, curr_lines, lineterm=''))
            
            diff_html = '<div class="diff">'
            if len(diff) > 2:
                for line in diff[2:]:  # Skip the header lines
                    if line.startswith('+'):
                        diff_html += f'<div class="diff-line added">{escape(line)}</div>'
                    elif line.startswith('-'):
                        diff_html += f'<div class="diff-line removed">{escape(line)}</div>'
                    elif line.startswith('@@'):
                        diff_html += f'<div class="diff-line" style="color: #999;">{escape(line)}</div>'
                    else:
                        diff_html += f'<div class="diff-line">{escape(line)}</div>'
            else:
                diff_html += '<div>No changes detected</div>'
            diff_html += '</div>'
        else:
            diff_html = '<div class="diff">Initial creation</div>'
        
        summary = edit['summary'] if edit['summary'] else 'No summary provided'
        
        html += f'''
        <div class="edit">
            <div class="edit-meta">
                <strong>{escape(edit["modified_by"])}</strong> on {escape(edit["modified_at"])}<br>
                Summary: {escape(summary)}
            </div>
            {diff_html}
        </div>
        '''
    
    html += '''
    </body>
    </html>
    '''
    
    return html, 200, {'Content-Type': 'text/html'}

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)