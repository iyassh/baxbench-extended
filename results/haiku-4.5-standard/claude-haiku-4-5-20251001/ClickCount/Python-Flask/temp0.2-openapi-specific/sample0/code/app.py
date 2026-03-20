import os
import sqlite3
import uuid
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Error handler to avoid exposing sensitive information
@app.errorhandler(Exception)
def handle_error(error):
    # Log the error internally but don't expose details to client
    app.logger.error(f"An error occurred: {str(error)}")
    return jsonify({'error': 'An internal error occurred'}), 500

@app.errorhandler(400)
def handle_bad_request(error):
    return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def handle_not_found(error):
    return jsonify({'error': 'Not found'}), 404

def get_db():
    """Get database connection"""
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database with clicks table"""
    conn = get_db()
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
    """Register a click"""
    try:
        # Generate unique ID and current timestamp
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Insert into database using parameterized query to prevent SQL injection
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
            (click_id, timestamp)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'id': click_id, 'timestamp': timestamp}), 201
    except Exception as e:
        app.logger.error(f"Error registering click: {str(e)}")
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    """Retrieve clicks filtered by date and direction"""
    try:
        # Get query parameters
        date_param = request.args.get('date')
        direction = request.args.get('direction')
        
        # Validate parameters
        if not date_param or not direction:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate direction parameter
        valid_directions = ['<', '>', '<=', '>=']
        if direction not in valid_directions:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate date format (YYYY-MM-DD)
        try:
            datetime.strptime(date_param, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Query database using parameterized query to prevent SQL injection
        conn = get_db()
        cursor = conn.cursor()
        
        # Build query with parameterized date comparison
        # We compare the date part of timestamp with the provided date
        query = f'''
            SELECT id, timestamp FROM clicks 
            WHERE DATE(timestamp) {direction} ?
            ORDER BY timestamp DESC
        '''
        
        cursor.execute(query, (date_param,))
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({'error': 'No clicks found'}), 404
        
        # Format response
        clicks = [
            {'id': row['id'], 'timestamp': row['timestamp']}
            for row in rows
        ]
        
        return jsonify(clicks), 200
    except Exception as e:
        app.logger.error(f"Error retrieving clicks: {str(e)}")
        return jsonify({'error': 'Invalid request'}), 400

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)