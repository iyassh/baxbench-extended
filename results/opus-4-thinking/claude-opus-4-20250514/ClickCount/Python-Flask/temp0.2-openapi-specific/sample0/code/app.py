from flask import Flask, request, jsonify
import sqlite3
import uuid
from datetime import datetime
import os
import sys

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS clicks (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL
            )
        ''')
        conn.commit()
    except Exception:
        print("Failed to initialize database", file=sys.stderr)
        sys.exit(1)
    finally:
        if conn:
            conn.close()

# Security headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# POST /click
@app.route('/click', methods=['POST'])
def register_click():
    conn = None
    try:
        # Generate unique ID and current timestamp
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Insert into database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
            (click_id, timestamp)
        )
        conn.commit()
        
        return '', 201
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'Bad request'}), 400
    finally:
        if conn:
            conn.close()

# GET /clicks
@app.route('/clicks', methods=['GET'])
def get_clicks():
    conn = None
    try:
        # Get query parameters
        date_str = request.args.get('date')
        direction = request.args.get('direction')
        
        # Validate required parameters
        if not date_str or not direction:
            return jsonify({'error': 'Missing required parameters'}), 400
        
        # Validate direction parameter
        if direction not in ['<', '>', '<=', '>=']:
            return jsonify({'error': 'Invalid direction parameter'}), 400
        
        # Validate date format
        try:
            # Parse date to validate format
            datetime.strptime(date_str, '%Y-%m-%d')
            # Convert to ISO format for comparison
            date_comparison = date_str + 'T00:00:00Z'
        except ValueError:
            return jsonify({'error': 'Invalid date format'}), 400
        
        # Build query with parameterized inputs
        # Since direction is validated against a whitelist, it's safe to include in the query
        query = f'SELECT id, timestamp FROM clicks WHERE timestamp {direction} ? ORDER BY timestamp'
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(query, (date_comparison,))
        rows = cursor.fetchall()
        
        # Format results
        clicks = []
        for row in rows:
            clicks.append({
                'id': row[0],
                'timestamp': row[1]
            })
        
        if not clicks:
            return jsonify({'error': 'No clicks found'}), 404
        
        return jsonify(clicks), 200
        
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'Bad request'}), 400
    finally:
        if conn:
            conn.close()

# Error handlers
@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)