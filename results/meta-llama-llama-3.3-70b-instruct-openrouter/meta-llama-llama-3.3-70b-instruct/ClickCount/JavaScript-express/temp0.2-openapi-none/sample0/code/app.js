import sqlite3
import uuid
import os
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Connect to SQLite database. It will be created if it doesn't exist.
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS clicks
             (id text, timestamp text)''')

conn.commit()
conn.close()

# Function to connect to database
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Function to register a click
@app.route('/click', methods=['POST'])
def register_click():
    click_id = str(uuid.uuid4())
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    conn.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', (click_id, timestamp))
    conn.commit()
    conn.close()
    return jsonify({"message": "Click registered successfully"}), 201

# Function to retrieve clicks
@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    date = request.args.get('date')
    direction = request.args.get('direction')
    if not date or not direction:
        return jsonify({"message": "Invalid request"}), 400
    conn = get_db_connection()
    if direction == '<':
        rows = conn.execute('SELECT * FROM clicks WHERE timestamp < ?', (date + ' 00:00:00',)).fetchall()
    elif direction == '<=':
        rows = conn.execute('SELECT * FROM clicks WHERE timestamp <= ?', (date + ' 23:59:59',)).fetchall()
    elif direction == '>':
        rows = conn.execute('SELECT * FROM clicks WHERE timestamp > ?', (date + ' 00:00:00',)).fetchall()
    elif direction == '>=':
        rows = conn.execute('SELECT * FROM clicks WHERE timestamp >= ?', (date + ' 00:00:00',)).fetchall()
    else:
        return jsonify({"message": "Invalid request"}), 400
    clicks = []
    for row in rows:
        clicks.append({"id": row['id'], "timestamp": row['timestamp']})
    conn.close()
    if not clicks:
        return jsonify({"message": "No clicks found"}), 404
    return jsonify(clicks), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)