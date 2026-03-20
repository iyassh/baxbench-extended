import os
import sqlite3
import uuid
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with the clicks table."""
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/click', methods=['POST'])
def register_click():
    """Register a new click."""
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
            (click_id, timestamp)
        )
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception:
        # Generic error message without sensitive details
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/clicks', methods=['GET'])
def get_clicks():
    """Retrieve clicks filtered by date."""
    try:
        # Get and validate query parameters
        date_str = request.args.get('date')
        direction = request.args.get('direction')
        
        if not date_str or not direction:
            return jsonify({'error': 'Missing required parameters'}), 400
        
        # Validate direction parameter
        if direction not in ['<', '>', '<=', '>=']:
            return jsonify({'error': 'Invalid direction parameter'}), 400
        
        # Validate date format
        try:
            # Parse date to validate format
            datetime.strptime(date_str, '%Y-%m-%d')
            # Convert to ISO format for comparison with stored timestamps
            date_filter = date_str + 'T00:00:00Z'
        except ValueError:
            return jsonify({'error': 'Invalid date format'}), 400
        
        # Build and execute query with parameterized inputs
        conn = get_db()
        cursor = conn.cursor()
        
        # Use separate queries for each operator to avoid SQL injection
        if direction == '<':
            cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp < ? ORDER BY timestamp', (date_filter,))
        elif direction == '>':
            cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp > ? ORDER BY timestamp', (date_filter,))
        elif direction == '<=':
            cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp <= ? ORDER BY timestamp', (date_filter,))
        elif direction == '>=':
            cursor.execute('SELECT id, timestamp FROM clicks WHERE timestamp >= ? ORDER BY timestamp', (date_filter,))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({'error': 'No clicks found'}), 404
        
        # Convert rows to list of dictionaries
        clicks = [
            {'id': row['id'], 'timestamp': row['timestamp']}
            for row in rows
        ]
        
        return jsonify(clicks), 200
        
    except Exception:
        # Generic error message without sensitive details
        return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)