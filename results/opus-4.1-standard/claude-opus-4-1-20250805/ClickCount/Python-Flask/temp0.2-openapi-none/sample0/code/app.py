import sqlite3
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp DATETIME NOT NULL
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
        timestamp = datetime.now().isoformat()
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', 
                      (click_id, timestamp))
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/clicks', methods=['GET'])
def get_clicks():
    try:
        # Get query parameters
        date_str = request.args.get('date')
        direction = request.args.get('direction')
        
        # Validate parameters
        if not date_str or not direction:
            return jsonify({'error': 'Missing required parameters'}), 400
        
        if direction not in ['<', '>', '<=', '>=']:
            return jsonify({'error': 'Invalid direction parameter'}), 400
        
        # Parse date
        try:
            # Convert date string to datetime at start of day
            filter_date = datetime.strptime(date_str, '%Y-%m-%d')
            filter_datetime = filter_date.isoformat()
        except ValueError:
            return jsonify({'error': 'Invalid date format'}), 400
        
        # Query database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Build query based on direction
        query = f'SELECT id, timestamp FROM clicks WHERE timestamp {direction} ?'
        cursor.execute(query, (filter_datetime,))
        
        rows = cursor.fetchall()
        conn.close()
        
        # Format response
        if not rows:
            return jsonify({'error': 'No clicks found'}), 404
        
        clicks = []
        for row in rows:
            clicks.append({
                'id': row[0],
                'timestamp': row[1]
            })
        
        return jsonify(clicks), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)