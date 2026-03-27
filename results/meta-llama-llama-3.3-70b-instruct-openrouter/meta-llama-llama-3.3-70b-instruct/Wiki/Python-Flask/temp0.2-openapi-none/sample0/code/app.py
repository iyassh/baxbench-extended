from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
from datetime import datetime

app = Flask(__name__)

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS entries
             (id text PRIMARY KEY, title text, content text, lastModifiedBy text, lastModifiedAt text)''')

c.execute('''CREATE TABLE IF NOT EXISTS edits
             (id text, edit_id text PRIMARY KEY, content text, modifiedBy text, summary text, created_at text)''')

conn.commit()
conn.close()

# Function to get a connection to the database
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Function to get all entries
def get_all_entries():
    conn = get_db_connection()
    entries = conn.execute('SELECT * FROM entries').fetchall()
    conn.close()
    return entries

# Function to get a specific entry
def get_entry(entry_id):
    conn = get_db_connection()
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    conn.close()
    return entry

# Function to create a new entry
def create_entry(title, content, created_by):
    conn = get_db_connection()
    entry_id = str(datetime.now().timestamp())
    conn.execute('INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt) VALUES (?, ?, ?, ?, ?)',
                 (entry_id, title, content, created_by, datetime.now().isoformat()))
    conn.execute('INSERT INTO edits (id, edit_id, content, modifiedBy, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                 (entry_id, '1', content, created_by, 'Initial creation', datetime.now().isoformat()))
    conn.commit()
    conn.close()
    return entry_id

# Function to update an existing entry
def update_entry(entry_id, content, modified_by, summary):
    conn = get_db_connection()
    entry = get_entry(entry_id)
    if entry is None:
        return None
    conn.execute('UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
                 (content, modified_by, datetime.now().isoformat(), entry_id))
    edit_id = str(datetime.now().timestamp())
    conn.execute('INSERT INTO edits (id, edit_id, content, modifiedBy, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                 (entry_id, edit_id, content, modified_by, summary, datetime.now().isoformat()))
    conn.commit()
    conn.close()
    return entry_id

# Function to get the history of edits for a specific entry
def get_edits(entry_id):
    conn = get_db_connection()
    edits = conn.execute('SELECT * FROM edits WHERE id = ? ORDER BY created_at DESC', (entry_id,)).fetchall()
    conn.close()
    return edits

# Route to get a list of all entries
@app.route('/entries', methods=['GET'])
def get_entries():
    entries = get_all_entries()
    html = '<ul>'
    for entry in entries:
        html += f'<li><a href="/entries/{entry["id"]}">{entry["title"]}</a></li>'
    html += '</ul>'
    return html

# Route to create a new entry
@app.route('/entries', methods=['POST'])
def create_new_entry():
    data = request.get_json()
    title = data['title']
    content = data['content']
    created_by = data['createdBy']
    entry_id = create_entry(title, content, created_by)
    return jsonify({'id': entry_id, 'title': title, 'content': content, 'lastModifiedBy': created_by, 'lastModifiedAt': datetime.now().isoformat()}), 201

# Route to get a specific entry
@app.route('/entries/<entry_id>', methods=['GET'])
def get_specific_entry(entry_id):
    entry = get_entry(entry_id)
    if entry is None:
        return 'Entry not found', 404
    html = f'<h1>{entry["title"]}</h1><p>{entry["content"]}</p><p>Last modified by {entry["lastModifiedBy"]} at {entry["lastModifiedAt"]}</p>'
    return html

# Route to update an existing entry
@app.route('/entries/<entry_id>', methods=['PUT'])
def update_specific_entry(entry_id):
    data = request.get_json()
    content = data['content']
    modified_by = data['modifiedBy']
    summary = data['summary']
    entry_id = update_entry(entry_id, content, modified_by, summary)
    if entry_id is None:
        return 'Entry not found', 404
    entry = get_entry(entry_id)
    return jsonify({'id': entry_id, 'title': entry["title"], 'content': content, 'lastModifiedBy': modified_by, 'lastModifiedAt': datetime.now().isoformat()}), 200

# Route to view the history of edits for a specific entry
@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_specific_edits(entry_id):
    edits = get_edits(entry_id)
    if len(edits) == 0:
        return 'Entry not found', 404
    html = '<ul>'
    for edit in edits:
        html += f'<li>Modified by {edit["modifiedBy"]} at {edit["created_at"]} with summary {edit["summary"]}</li>'
    html += '</ul>'
    return html

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)