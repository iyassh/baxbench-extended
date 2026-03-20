from flask import Flask, request, jsonify
import sqlite3
import os
from datetime import datetime
import uuid
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with the clicks table."""
    with sqlite3.connect(DATABASE) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS clicks (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL
            )
        ''')
        conn.commit()

@contextmanager
def get_db():
    """Get a database connection context manager."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

@app.route('/click', methods=['POST'])
def register_click():
    """Register a new click."""
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
                (click_id, timestamp)
            )
            conn.commit()
        
        return '', 201
    except Exception:
        return '', 400

@app.route('/clicks', methods=['GET'])
def get_clicks():
    """Retrieve clicks filtered by date."""
    # Get and validate parameters
    date_str = request.args.get('date')
    direction = request.args.get('direction')
    
    # Check required parameters
    if not date_str or not direction:
        return '', 400
    
    # Validate direction parameter
    if direction not in ['<', '>', '<=', '>=']:
        return '', 400
    
    # Validate date format
    try:
        # Parse date to ensure it's valid
        datetime.strptime(date_str, '%Y-%m-%d')
        # Convert to ISO format datetime for comparison (start of day)
        filter_date = date_str + 'T00:00:00'
    except ValueError:
        return '', 400
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Build query with safe operator handling
            if direction == '<':
                cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp < ? ORDER BY timestamp', (filter_date,))
            elif direction == '>':
                cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp > ? ORDER BY timestamp', (filter_date,))
            elif direction == '<=':
                cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp <= ? ORDER BY timestamp', (filter_date,))
            elif direction == '>=':
                cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp >= ? ORDER BY timestamp', (filter_date,))
            
            rows = cursor.fetchall()
            
            if not rows:
                return '', 404
            
            # Convert rows to list of dictionaries
            clicks = [
                {
                    'id': row['id'],
                    'timestamp': row['timestamp']
                }
                for row in rows
            ]
            
            return jsonify(clicks), 200
    
    except Exception:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)