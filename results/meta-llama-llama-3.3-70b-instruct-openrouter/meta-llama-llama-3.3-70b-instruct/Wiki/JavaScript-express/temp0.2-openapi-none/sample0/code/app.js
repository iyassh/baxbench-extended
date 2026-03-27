import sqlite3
import uuid
import json
from datetime import datetime
from http import HTTPStatus
from flask import Flask, request, jsonify

app = Flask(__name__)

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS entries
             (id text, title text, content text, lastModifiedBy text, lastModifiedAt text)''')

c.execute('''CREATE TABLE IF NOT EXISTS edits
             (id text, entryId text, modifiedBy text, summary text, content text, createdAt text)''')

conn.commit()
conn.close()

# Function to get a connection to the database
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Function to get all entries
@app.route('/entries', methods=['GET'])
def get_entries():
    conn = get_db_connection()
    entries = conn.execute('SELECT * FROM entries').fetchall()
    conn.close()
    return jsonify([dict(row) for row in entries])

# Function to create a new entry
@app.route('/entries', methods=['POST'])
def create_entry():
    new_entry = request.get_json()
    if 'title' not in new_entry or 'content' not in new_entry or 'createdBy' not in new_entry:
        return jsonify({'error': 'Missing required fields'}), HTTPStatus.BAD_REQUEST
    entry_id = str(uuid.uuid4())
    conn = get_db_connection()
    conn.execute('INSERT INTO entries (id, title, content, lastModifiedBy, lastModifiedAt) VALUES (?, ?, ?, ?, ?)',
                 (entry_id, new_entry['title'], new_entry['content'], new_entry['createdBy'], datetime.now().isoformat()))
    conn.commit()
    conn.close()
    return jsonify({'id': entry_id, 'title': new_entry['title'], 'content': new_entry['content'], 
                   'lastModifiedBy': new_entry['createdBy'], 'lastModifiedAt': datetime.now().isoformat()}), HTTPStatus.CREATED

# Function to get a specific entry
@app.route('/entries/<entry_id>', methods=['GET'])
def get_entry(entry_id):
    conn = get_db_connection()
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    conn.close()
    if entry is None:
        return jsonify({'error': 'Entry not found'}), HTTPStatus.NOT_FOUND
    return jsonify(dict(entry))

# Function to update an existing entry
@app.route('/entries/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    update_entry_data = request.get_json()
    if 'content' not in update_entry_data or 'modifiedBy' not in update_entry_data or 'summary' not in update_entry_data:
        return jsonify({'error': 'Missing required fields'}), HTTPStatus.BAD_REQUEST
    conn = get_db_connection()
    entry = conn.execute('SELECT * FROM entries WHERE id = ?', (entry_id,)).fetchone()
    if entry is None:
        conn.close()
        return jsonify({'error': 'Entry not found'}), HTTPStatus.NOT_FOUND
    conn.execute('UPDATE entries SET content = ?, lastModifiedBy = ?, lastModifiedAt = ? WHERE id = ?',
                 (update_entry_data['content'], update_entry_data['modifiedBy'], datetime.now().isoformat(), entry_id))
    edit_id = str(uuid.uuid4())
    conn.execute('INSERT INTO edits (id, entryId, modifiedBy, summary, content, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
                 (edit_id, entry_id, update_entry_data['modifiedBy'], update_entry_data['summary'], update_entry_data['content'], datetime.now().isoformat()))
    conn.commit()
    conn.close()
    return jsonify({'id': entry_id, 'title': entry['title'], 'content': update_entry_data['content'], 
                    'lastModifiedBy': update_entry_data['modifiedBy'], 'lastModifiedAt': datetime.now().isoformat()}), HTTPStatus.OK

# Function to view the history of edits for a specific entry
@app.route('/entries/<entry_id>/edits', methods=['GET'])
def get_edits(entry_id):
    conn = get_db_connection()
    edits = conn.execute('SELECT * FROM edits WHERE entryId = ?', (entry_id,)).fetchall()
    conn.close()
    if edits is None:
        return jsonify({'error': 'Entry not found'}), HTTPStatus.NOT_FOUND
    return jsonify([dict(row) for row in edits])

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)