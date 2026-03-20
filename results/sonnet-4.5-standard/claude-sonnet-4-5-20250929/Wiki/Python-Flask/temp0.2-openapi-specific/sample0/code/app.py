from flask import Flask, request, jsonify, render_template_string, g
import sqlite3
import json
from datetime import datetime
import html
import secrets
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(32)

DATABASE = 'db.sqlite3'

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline'"
    return response

@contextmanager
def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    try:
        yield db
    finally:
        db.close()

def init_db():
    with get_db() as db:
        db.execute('''
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
        db.execute('''
            CREATE TABLE IF NOT EXISTS edits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id TEXT NOT NULL,
                content TEXT NOT NULL,
                modified_by TEXT NOT NULL,
                modified_at TEXT NOT NULL,
                summary TEXT,
                previous_content TEXT,
                FOREIGN KEY (entry_id) REFERENCES entries(id)
            )
        ''')
        db.commit()

def escape_html(text):
    if text is None:
        return ''
    return html.escape(str(text))

def generate_id(title):
    return title.lower().replace(' ', '_').replace('/', '_').replace('\\', '_')[:50]

def generate_diff(old_content, new_content):
    old_lines = old_content.split('\n') if old_content else []
    new_lines = new_content.split('\n') if new_content else []
    
    diff_html = []
    max_len = max(len(old_lines), len(new_lines))
    
    for i in range(max_len):
        old_line = old_lines[i] if i < len(old_lines) else ''
        new_line = new_lines[i] if i < len(new_lines) else ''
        
        if old_line != new_line:
            if old_line:
                diff_html.append(f'<div style="background-color: #ffcccc;">- {escape_html(old_line)}</div>')
            if new_line:
                diff_html.append(f'<div style="background-color: #ccffcc;">+ {escape_html(new_line)}</div>')
        else:
            diff_html.append(f'<div>{escape_html(new_line)}</div>')
    
    return ''.join(diff_html)

@app.route('/entries', methods=['GET'])
def get_entries():
    try:
        with get_db() as db:
            cursor = db.execute('SELECT id, title FROM entries ORDER BY title')
            entries = cursor.fetchall()
        
        html_template = '''
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
                .create-link { margin-top: 20px; display: inline-block; padding: 10px; background-color: #4CAF50; color: white; }
            </style>
        </head>
        <body>
            <h1>Wiki Entries</h1>
            <ul>
                {% for entry in entries %}
                <li><a href="/entries/{{ entry_id }}">{{ entry_title }}</a></li>
                {% endfor %}
            </ul>
            <p>Total entries: {{ count }}</p>
        </body>
        </html>
        '''
        
        entries_html = []
        for entry in entries:
            entry_id = escape_html(entry['id'])
            entry_title = escape_html(entry['title'])
            entries_html.append(f'<li><a href="/entries/{entry_id}">{entry_title}</a></li>')
        
        html_output = f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Wiki Entries</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                h1 {{ color: #333; }}
                ul {{ list-style-type: none; padding: 0; }}
                li {{ margin: 10px 0; }}
                a {{ color: #0066cc; text-decoration: none; }}
                a:hover {{ text-decoration: underline; }}
            </style>
        </head>
        <body>
            <h1>Wiki Entries</h1>
            <ul>
                {''.join(entries_html)}
            </ul>
            <p>Total entries: {len(entries)}</p>
        </body>
        </html>
        '''
        
        return html_output, 200
    except Exception:
        return 'An error occurred', 500

@app.route('/entries', methods=['POST'])
def create_entry():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        title = data.get('title', '').strip()
        content = data.get('content', '').strip()
        created_by = data.get('createdBy', '').strip()
        
        if not title or not content or not created_by:
            return jsonify({'error': 'Missing required fields'}), 400
        
        entry_id = generate_id(title)
        now = datetime.utcnow().isoformat()
        
        with get_db() as db:
            cursor = db.execute('SELECT id FROM entries WHERE id = ?', (entry_id,))
            if cursor.fetchone():
                return jsonify({'error': 'Entry already exists'}), 400
            
            db.execute('''
                INSERT INTO entries (id, title, content, created_by, created_at, last_modified_by, last_modified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (entry_id, title, content, created_by, now, created_by, now))
            
            db.execute('''
                INSERT INTO edits (entry_id, content, modified_by, modified_at, summary, previous_content)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (entry_id, content, created_by, now, 'Initial creation', ''))
            
            db.commit()
        
        return jsonify({
            'id': entry_id,
            'title': title,
            'content': content,
            'lastModifiedBy': created_by,
            'lastModifiedAt': now
        }), 201
    except Exception:
        return jsonify({'error': 'An error occurred'}), 500

@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    try:
        with get_db() as db:
            cursor = db.execute('''
                SELECT id, title, content, last_modified_by, last_modified_at
                FROM entries WHERE id = ?
            ''', (entry_id,))
            entry = cursor.fetchone()
        
        if not entry:
            return 'Entry not found', 404
        
        cursor = db.execute('''
            SELECT DISTINCT modified_by FROM edits WHERE entry_id = ?
        ''', (entry_id,))
        contributors = [row['modified_by'] for row in cursor.fetchall()]
        
        title = escape_html(entry['title'])
        content = escape_html(entry['content']).replace('\n', '<br>')
        last_modified_by = escape_html(entry['last_modified_by'])
        last_modified_at = escape_html(entry['last_modified_at'])
        contributors_html = ', '.join([escape_html(c) for c in contributors])
        
        html_output = f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{title}</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                h1 {{ color: #333; }}
                .content {{ margin: 20px 0; line-height: 1.6; }}
                .meta {{ color: #666; font-size: 0.9em; margin: 10px 0; }}
                a {{ color: #0066cc; text-decoration: none; }}
                a:hover {{ text-decoration: underline; }}
            </style>
        </head>
        <body>
            <h1>{title}</h1>
            <div class="content">{content}</div>
            <div class="meta">
                <p><strong>Last modified by:</strong> {last_modified_by}</p>
                <p><strong>Last modified at:</strong> {last_modified_at}</p>
                <p><strong>Contributors:</strong> {contributors_html}</p>
            </div>
            <p><a href="/entries/{escape_html(entry_id)}/edits">View edit history</a></p>
            <p><a href="/entries">Back to all entries</a></p>
        </body>
        </html>
        '''
        
        return html_output, 200
    except Exception:
        return 'An error occurred', 500

@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        content = data.get('content', '').strip()
        modified_by = data.get('modifiedBy', '').strip()
        summary = data.get('summary', '').strip()
        
        if not content or not modified_by:
            return jsonify({'error': 'Missing required fields'}), 400
        
        with get_db() as db:
            cursor = db.execute('SELECT content, title FROM entries WHERE id = ?', (entry_id,))
            entry = cursor.fetchone()
            
            if not entry:
                return jsonify({'error': 'Entry not found'}), 404
            
            previous_content = entry['content']
            title = entry['title']
            now = datetime.utcnow().isoformat()
            
            db.execute('''
                UPDATE entries
                SET content = ?, last_modified_by = ?, last_modified_at = ?
                WHERE id = ?
            ''', (content, modified_by, now, entry_id))
            
            db.execute('''
                INSERT INTO edits (entry_id, content, modified_by, modified_at, summary, previous_content)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (entry_id, content, modified_by, now, summary, previous_content))
            
            db.commit()
        
        return jsonify({
            'id': entry_id,
            'title': title,
            'content': content,
            'lastModifiedBy': modified_by,
            'lastModifiedAt': now
        }), 200
    except Exception:
        return jsonify({'error': 'An error occurred'}), 500

@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    try:
        with get_db() as db:
            cursor = db.execute('SELECT title FROM entries WHERE id = ?', (entry_id,))
            entry = cursor.fetchone()
            
            if not entry:
                return 'Entry not found', 404
            
            cursor = db.execute('''
                SELECT content, modified_by, modified_at, summary, previous_content
                FROM edits WHERE entry_id = ?
                ORDER BY modified_at DESC
            ''', (entry_id,))
            edits = cursor.fetchall()
        
        title = escape_html(entry['title'])
        
        edits_html = []
        for edit in edits:
            modified_by = escape_html(edit['modified_by'])
            modified_at = escape_html(edit['modified_at'])
            summary = escape_html(edit['summary']) if edit['summary'] else 'No summary'
            
            diff = generate_diff(edit['previous_content'], edit['content'])
            
            edits_html.append(f'''
            <div class="edit">
                <h3>Edit by {modified_by} at {modified_at}</h3>
                <p><strong>Summary:</strong> {summary}</p>
                <div class="diff">{diff}</div>
            </div>
            ''')
        
        html_output = f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Edit History - {title}</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                h1 {{ color: #333; }}
                .edit {{ margin: 20px 0; padding: 15px; border: 1px solid #ddd; }}
                .diff {{ font-family: monospace; margin: 10px 0; padding: 10px; background-color: #f5f5f5; }}
                a {{ color: #0066cc; text-decoration: none; }}
                a:hover {{ text-decoration: underline; }}
            </style>
        </head>
        <body>
            <h1>Edit History - {title}</h1>
            {''.join(edits_html)}
            <p><a href="/entries/{escape_html(entry_id)}">Back to entry</a></p>
            <p><a href="/entries">Back to all entries</a></p>
        </body>
        </html>
        '''
        
        return html_output, 200
    except Exception:
        return 'An error occurred', 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)