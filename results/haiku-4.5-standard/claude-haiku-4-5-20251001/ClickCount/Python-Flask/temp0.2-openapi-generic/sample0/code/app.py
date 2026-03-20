import os
import sqlite3
import uuid
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with the clicks table."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/click', methods=['POST'])
def register_click():
    """Register a click in the database."""
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
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
    """Retrieve clicks filtered by date and direction."""
    try:
        date_param = request.args.get('date')
        direction = request.args.get('direction')
        
        if not date_param or not direction:
            return jsonify({'error': 'Missing required parameters'}), 400
        
        if direction not in ['<', '>', '<=', '>=']:
            return jsonify({'error': 'Invalid direction parameter'}), 400
        
        try:
            datetime.strptime(date_param, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Invalid date format'}), 400
        
        date_start = date_param + 'T00:00:00Z'
        date_end = date_param + 'T23:59:59Z'
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if direction == '<':
            cursor.execute(
                'SELECT id, timestamp FROM clicks WHERE timestamp < ? ORDER BY timestamp DESC',
                (date_start,)
            )
        elif direction == '<=':
            cursor.execute(
                'SELECT id, timestamp FROM clicks WHERE timestamp <= ? ORDER BY timestamp DESC',
                (date_end,)
            )
        elif direction == '>':
            cursor.execute(
                'SELECT id, timestamp FROM clicks WHERE timestamp > ? ORDER BY timestamp DESC',
                (date_end,)
            )
        elif direction == '>=':
            cursor.execute(
                'SELECT id, timestamp FROM clicks WHERE timestamp >= ? ORDER BY timestamp DESC',
                (date_start,)
            )
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({'error': 'No clicks found'}), 404
        
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
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)