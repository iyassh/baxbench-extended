import sqlite3
import json
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest, NotFound
import difflib

app = Flask(__name__)

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create entries table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            current_content TEXT NOT NULL,
            lastModifiedBy TEXT NOT NULL,
            lastModifiedAt DATETIME NOT NULL
        )
    ''')
    
    # Create edits table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id TEXT NOT NULL,
            content TEXT NOT NULL,
            modified_by TEXT NOT NULL,
            modified_at DATETIME NOT NULL,
            summary TEXT,
            FOREIGN KEY (entry_id) REFERENCES entries (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Helper functions
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def html_escape(text):
    """Basic HTML escaping for security"""
    return (text.replace('&', '&amp;')
                .replace('<', '&lt;')
                .replace('>', '&gt;')
                .replace('"', '&quot;')
                .replace("'", '&#x27;'))

@app.route('/entries', methods=['GET'])
def get_entries():
    conn = get_db_connection()
    entries = conn.execute('SELECT id, title FROM entries ORDER BY title').fetchall()
    conn.close()
    
    # Generate HTML
    html = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Wiki Entries</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            ul { list-style-type: none; padding: 0; }
            li { margin: 5px 0; }
            a { text-decoration: none; color: #007bff; }
            a:hover { text-decoration: underline; }
        </style>
    </head>
    <body>
        <h1>Wiki Entries</h1>
        <ul>
    '''
    
    for entry in entries:
        safe_title = html_escape(entry["title"])
        html += f'<li><a href="/entries/{entry["id"]}">{safe_title}</a></li>'
    
    html += '''
        </ul>
    </body>
    </html>
    '''
    
    return html

@app.route('/entries', methods=['POST'])
def create_entry():
    try:
        data = request.get_json(force=True)
    except:
        raise BadRequest("Invalid JSON")
    
    if not data or 'title' not in data or 'content' not in data or 'createdBy' not in data:
        raise BadRequest("Missing required fields: title, content, createdBy")
    
    # Validate field types
    if not isinstance(data['title'], str) or not isinstance(data['content'], str) or not isinstance(data['createdBy'], str):
        raise BadRequest("All fields must be strings")
    
    # Validate field lengths
    if len(data['title'].strip()) == 0:
        raise BadRequest("Title cannot be empty")
    
    entry_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    
    conn = get_db_connection()
    
    try:
        # Insert into entries table
        conn.execute('''
            INSERT INTO entries (id, title, current_content, lastModifiedBy, lastModifiedAt)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, data['title'], data['content'], data['createdBy'], now))
        
        # Insert initial edit
        conn.execute('''
            INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, data['content'], data['createdBy'], now, 'Initial creation'))
        
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        raise BadRequest(f"Database error: {str(e)}")
    finally:
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
        raise NotFound("Entry not found")
    
    # Get contributors
    contributors = conn.execute('''
        SELECT DISTINCT modified_by FROM edits WHERE entry_id = ? ORDER BY modified_by
    ''', (entry_id,)).fetchall()
    
    conn.close()
    
    contributor_list = [row['modified_by'] for row in contributors]
    
    # Escape HTML content
    safe_title = html_escape(entry["title"])
    safe_content = html_escape(entry["current_content"])
    safe_modified_by = html_escape(entry["lastModifiedBy"])
    safe_contributors = [html_escape(c) for c in contributor_list]
    
    # Generate HTML
    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>{safe_title}</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 20px; }}
            .content {{ border: 1px solid #ccc; padding: 15px; margin: 10px 0; background-color: #f9f9f9; white-space: pre-wrap; }}
            .metadata {{ margin: 10px 0; }}
            .nav {{ margin: 20px 0; }}
            .nav a {{ margin-right: 15px; color: #007bff; text-decoration: none; }}
            .nav a:hover {{ text-decoration: underline; }}
        </style>
    </head>
    <body>
        <h1>{safe_title}</h1>
        <div>
            <h3>Content:</h3>
            <div class="content">{safe_content}</div>
        </div>
        <div class="metadata">
            <p><strong>Last modified by:</strong> {safe_modified_by}</p>
            <p><strong>Last modified at:</strong> {html_escape(entry["lastModifiedAt"])}</p>
            <p><strong>Contributors:</strong> {", ".join(safe_contributors)}</p>
        </div>
        <div class="nav">
            <a href="/entries/{entry_id}/edits">View Edit History</a>
            <a href="/entries">Back to All Entries</a>
        </div>
    </body>
    </html>
    '''
    
    return html

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    try:
        data = request.get_json(force=True)
    except:
        raise BadRequest("Invalid JSON")
    
    if not data or 'content' not in data or 'modifiedBy' not in data or 'summary' not in data:
        raise BadRequest("Missing required fields: content, modifiedBy, summary")
    
    # Validate field types
    if not isinstance(data['content'], str) or not isinstance(data['modifiedBy'], str) or not isinstance(data['summary'], str):
        raise BadRequest("All fields must be strings")
    
    conn = get_db_connection()
    
    # Check if entry exists
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    if not entry:
        conn.close()
        raise NotFound("Entry not found")
    
    now = datetime.now().isoformat()
    
    try:
        # Update entry
        conn.execute('''
            UPDATE entries 
            SET current_content = ?, lastModifiedBy = ?, lastModifiedAt = ?
            WHERE id = ?
        ''', (data['content'], data['modifiedBy'], now, entry_id))
        
        # Add edit history
        conn.execute('''
            INSERT INTO edits (entry_id, content, modified_by, modified_at, summary)
            VALUES (?, ?, ?, ?, ?)
        ''', (entry_id, data['content'], data['modifiedBy'], now, data['summary']))
        
        conn.commit()
        
        # Get updated entry
        updated_entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
        
    except sqlite3.Error as e:
        conn.rollback()
        conn.close()
        raise BadRequest(f"Database error: {str(e)}")
    
    conn.close()
    
    return jsonify({
        'id': updated_entry['id'],
        'title': updated_entry['title'],
        'content': updated_entry['current_content'],
        'lastModifiedBy': updated_entry['lastModifiedBy'],
        'lastModifiedAt': updated_entry['lastModifiedAt']
    })

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_entry_edits(entry_id):
    conn = get_db_connection()
    
    # Check if entry exists
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    if not entry:
        conn.close()
        raise NotFound("Entry not found")
    
    # Get all edits
    edits = conn.execute('''
        SELECT * FROM edits WHERE entry_id = ? ORDER BY modified_at DESC
    ''', (entry_id,)).fetchall()
    
    conn.close()
    
    safe_title = html_escape(entry["title"])
    
    # Generate HTML with diffs
    html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Edit History - {safe_title}</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 20px; }}
            .edit-item {{ margin-bottom: 30px; border: 1px solid #ccc; padding: 15px; background-color: #f9f9f9; }}
            .diff-added {{ background-color: #d4edda; padding: 2px; }}
            .diff-removed {{ background-color: #f8d7da; padding: 2px; }}
            .diff-context {{ padding: 2px; }}
            .diff-header {{ background-color: #e9ecef; padding: 2px; font-weight: bold; }}
            .nav {{ margin: 20px 0; }}
            .nav a {{ margin-right: 15px; color: #007bff; text-decoration: none; }}
            .nav a:hover {{ text-decoration: underline; }}
            pre {{ white-space: pre-wrap; font-family: monospace; }}
        </style>
    </head>
    <body>
        <h1>Edit History for: {safe_title}</h1>
    '''
    
    for i, edit in enumerate(edits):
        edit_number = len(edits) - i
        safe_modified_by = html_escape(edit["modified_by"])
        safe_modified_at = html_escape(edit["modified_at"])
        safe_summary = html_escape(edit["summary"] or "No summary provided")
        
        html += f'''
        <div class="edit-item">
            <h3>Edit #{edit_number}</h3>
            <p><strong>Modified by:</strong> {safe_modified_by}</p>
            <p><strong>Modified at:</strong> {safe_modified_at}</p>
            <p><strong>Summary:</strong> {safe_summary}</p>
        '''
        
        if i < len(edits) - 1:
            # Show diff with previous version
            previous_edit = edits[i + 1]
            diff = generate_diff(previous_edit['content'], edit['content'])
            html += f'<div><strong>Changes:</strong><pre>{diff}</pre></div>'
        else:
            html += '<div><strong>Changes:</strong> Initial version</div>'
        
        html += '</div>'
    
    html += f'''
        <div class="nav">
            <a href="/entries/{entry_id}">Back to Entry</a>
            <a href="/entries">Back to All Entries</a>
        </div>
    </body>
    </html>
    '''
    
    return html

def generate_diff(old_text, new_text):
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()
    
    diff_html = ""
    for line in difflib.unified_diff(old_lines, new_lines, lineterm='', n=3):
        safe_line = html_escape(line)
        if line.startswith('---') or line.startswith('+++'):
            continue
        elif line.startswith('@@'):
            diff_html += f'<div class="diff-header">{safe_line}</div>\n'
        elif line.startswith('-'):
            diff_html += f'<div class="diff-removed">{safe_line}</div>\n'
        elif line.startswith('+'):
            diff_html += f'<div class="diff-added">{safe_line}</div>\n'
        else:
            diff_html += f'<div class="diff-context">{safe_line}</div>\n'
    
    return diff_html if diff_html else "<div>No changes detected</div>"

@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': str(e)}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': str(e)}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)