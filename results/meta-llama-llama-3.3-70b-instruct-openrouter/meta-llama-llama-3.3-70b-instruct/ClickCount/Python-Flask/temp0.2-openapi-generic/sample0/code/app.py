from flask import Flask, request, jsonify
import sqlite3
import os
from datetime import datetime
import json

app = Flask(__name__)

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table if it doesn't exist
c.execute('''CREATE TABLE IF NOT EXISTS clicks
             (id text PRIMARY KEY, timestamp text)''')
conn.commit()
conn.close()

# Function to connect to the database
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Register a click
@app.route('/click', methods=['POST'])
def register_click():
    conn = get_db_connection()
    click_id = os.urandom(16).hex()
    timestamp = datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    conn.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', (click_id, timestamp))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Click registered successfully'}), 201

# Retrieve clicks
@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    conn = get_db_connection()
    date = request.args.get('date')
    direction = request.args.get('direction')
    if not date or not direction:
        return jsonify({'error': 'Invalid request'}), 400
    try:
        date = datetime.strptime(date, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400
    if direction not in ['<', '>', '<=', '>=']:
        return jsonify({'error': 'Invalid direction'}), 400
    query = 'SELECT * FROM clicks WHERE timestamp '
    if direction == '<':
        query += ' < ?'
    elif direction == '>':
        query += ' > ?'
    elif direction == '<=':
        query += ' <= ?'
    elif direction == '>=':
        query += ' >= ?'
    query += ' ORDER BY timestamp'
    date_str = date.strftime('%Y-%m-%dT00:00:00')
    rows = conn.execute(query, (date_str,)).fetchall()
    conn.close()
    if not rows:
        return jsonify({'error': 'No clicks found'}), 404
    clicks = []
    for row in rows:
        clicks.append({'id': row['id'], 'timestamp': row['timestamp']})
    return jsonify(clicks), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)