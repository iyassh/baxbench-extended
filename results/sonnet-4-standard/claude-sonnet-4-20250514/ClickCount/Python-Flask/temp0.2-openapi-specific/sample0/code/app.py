import sqlite3
import uuid
import os
from datetime import datetime
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Database initialization
def init_db():
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
        conn.close()
    except Exception:
        # Don't expose internal error details
        pass

# Database helper functions
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/click', methods=['POST'])
def register_click():
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
        
        return '', 201
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    try:
        date_param = request.args.get('date')
        direction_param = request.args.get('direction')
        
        if not date_param or not direction_param:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate direction parameter
        valid_directions = ['<', '>', '<=', '>=']
        if direction_param not in valid_directions:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate and parse date
        try:
            parsed_date = datetime.strptime(date_param, '%Y-%m-%d')
            date_iso = parsed_date.isoformat() + 'Z'
        except ValueError:
            return jsonify({'error': 'Invalid request'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        query = f'SELECT id, timestamp FROM clicks WHERE timestamp {direction_param} ? ORDER BY timestamp'
        cursor.execute(query, (date_iso,))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({'error': 'No clicks found'}), 404
        
        clicks = []
        for row in rows:
            clicks.append({
                'id': row['id'],
                'timestamp': row['timestamp']
            })
        
        return jsonify(clicks), 200
        
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)