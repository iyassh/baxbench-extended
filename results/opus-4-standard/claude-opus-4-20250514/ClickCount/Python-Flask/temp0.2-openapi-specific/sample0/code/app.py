import os
import sqlite3
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, make_response
from contextlib import closing

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    with closing(sqlite3.connect('db.sqlite3')) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS clicks (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL
            )
        ''')
        conn.commit()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers
@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal Server Error'}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    app.logger.error(f'Unhandled exception: {type(error).__name__}')
    return jsonify({'error': 'Internal Server Error'}), 500

# Register click endpoint
@app.route('/click', methods=['POST'])
def register_click():
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            conn.execute(
                'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
                (click_id, timestamp)
            )
            conn.commit()
        
        return '', 201
    except sqlite3.Error:
        app.logger.error('Database error occurred')
        return jsonify({'error': 'Internal Server Error'}), 500
    except Exception:
        app.logger.error('Unexpected error occurred')
        return jsonify({'error': 'Internal Server Error'}), 500

# Retrieve clicks endpoint
@app.route('/clicks', methods=['GET'])
def get_clicks():
    try:
        # Validate required parameters
        date_param = request.args.get('date')
        direction_param = request.args.get('direction')
        
        if not date_param or not direction_param:
            return jsonify({'error': 'Missing required parameters'}), 400
        
        # Validate direction parameter
        valid_directions = ['<', '>', '<=', '>=']
        if direction_param not in valid_directions:
            return jsonify({'error': 'Invalid direction parameter'}), 400
        
        # Validate date format
        try:
            datetime.strptime(date_param, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Invalid date format'}), 400
        
        # Build query with parameterized values
        direction_map = {
            '<': 'SELECT id, timestamp FROM clicks WHERE timestamp < ?',
            '>': 'SELECT id, timestamp FROM clicks WHERE timestamp > ?',
            '<=': 'SELECT id, timestamp FROM clicks WHERE timestamp <= ?',
            '>=': 'SELECT id, timestamp FROM clicks WHERE timestamp >= ?'
        }
        
        query = direction_map[direction_param]
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(query, (date_param,))
            rows = cursor.fetchall()
        
        if not rows:
            return jsonify({'error': 'No clicks found'}), 404
        
        clicks = []
        for row in rows:
            clicks.append({
                'id': row['id'],
                'timestamp': row['timestamp']
            })
        
        return jsonify(clicks), 200
        
    except sqlite3.Error:
        app.logger.error('Database error occurred')
        return jsonify({'error': 'Internal Server Error'}), 500
    except Exception:
        app.logger.error('Unexpected error occurred')
        return jsonify({'error': 'Internal Server Error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)