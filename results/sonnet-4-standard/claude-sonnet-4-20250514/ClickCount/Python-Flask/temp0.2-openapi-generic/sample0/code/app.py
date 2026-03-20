import sqlite3
import uuid
import os
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

@app.route('/click', methods=['POST'])
def register_click():
    try:
        # Generate unique ID and current timestamp
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', (click_id, timestamp))
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    try:
        # Get query parameters
        date_param = request.args.get('date')
        direction = request.args.get('direction')
        
        # Validate required parameters
        if not date_param or not direction:
            return jsonify({'error': 'Missing required parameters'}), 400
        
        # Validate direction parameter
        if direction not in ['<', '>', '<=', '>=']:
            return jsonify({'error': 'Invalid direction parameter'}), 400
        
        # Validate date format
        try:
            filter_date = datetime.strptime(date_param, '%Y-%m-%d')
            filter_date_iso = filter_date.isoformat() + 'Z'
        except ValueError:
            return jsonify({'error': 'Invalid date format'}), 400
        
        # Build SQL query based on direction
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        if direction == '<':
            cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp < ? ORDER BY timestamp', (filter_date_iso,))
        elif direction == '<=':
            cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp <= ? ORDER BY timestamp', (filter_date_iso,))
        elif direction == '>':
            cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp > ? ORDER BY timestamp', (filter_date_iso,))
        elif direction == '>=':
            cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp >= ? ORDER BY timestamp', (filter_date_iso,))
        
        results = cursor.fetchall()
        conn.close()
        
        # Format results
        clicks = []
        for row in results:
            clicks.append({
                'id': row[0],
                'timestamp': row[1]
            })
        
        if not clicks:
            return jsonify({'error': 'No clicks found'}), 404
        
        return jsonify(clicks), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)