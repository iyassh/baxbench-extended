import sqlite3
import os
from datetime import datetime
from flask import Flask, request, jsonify
import uuid

app = Flask(__name__)

# Database initialization
DB_PATH = 'db.sqlite3'

def init_db():
    """Initialize the database with the clicks table."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/click', methods=['POST'])
def register_click():
    """Register a click in the database."""
    try:
        # Generate a unique ID and timestamp
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Insert into database
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
            (click_id, timestamp)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'id': click_id, 'timestamp': timestamp}), 201
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    """Retrieve clicks before or after a certain date."""
    try:
        # Get query parameters
        date_str = request.args.get('date')
        direction = request.args.get('direction')
        
        # Validate parameters
        if not date_str or not direction:
            return jsonify({'error': 'Invalid request'}), 400
        
        if direction not in ['<', '>', '<=', '>=']:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Parse the date
        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
            # Convert to ISO format for comparison
            date_iso = date_obj.isoformat()
        except ValueError:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Query the database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Build the query based on direction
        if direction == '<':
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp < ? ORDER BY timestamp DESC'
        elif direction == '>':
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp > ? ORDER BY timestamp DESC'
        elif direction == '<=':
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp <= ? ORDER BY timestamp DESC'
        elif direction == '>=':
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp >= ? ORDER BY timestamp DESC'
        
        cursor.execute(query, (date_iso,))
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({'error': 'No clicks found'}), 404
        
        # Format the response
        clicks = [{'id': row['id'], 'timestamp': row['timestamp']} for row in rows]
        return jsonify(clicks), 200
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405

if __name__ == '__main__':
    # Initialize the database
    init_db()
    
    # Start the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)