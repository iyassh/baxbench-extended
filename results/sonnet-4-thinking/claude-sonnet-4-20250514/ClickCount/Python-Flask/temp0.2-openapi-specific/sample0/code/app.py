import sqlite3
import os
from datetime import datetime
from flask import Flask, request, jsonify
import uuid

app = Flask(__name__)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Initialize database
def init_db():
    try:
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS clicks (
                    id TEXT PRIMARY KEY,
                    timestamp DATETIME
                )
            ''')
            conn.commit()
    except Exception:
        pass

@app.route('/click', methods=['POST'])
def register_click():
    try:
        # Generate unique ID and current timestamp
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Store in database
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', 
                          (click_id, timestamp))
            conn.commit()
        
        return '', 201
        
    except Exception:
        return '', 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    try:
        # Get query parameters
        date = request.args.get('date')
        direction = request.args.get('direction')
        
        # Validate parameters
        if not date or not direction:
            return '', 400
            
        # Validate date format
        try:
            datetime.strptime(date, '%Y-%m-%d')
        except ValueError:
            return '', 400
        
        # Map direction to safe queries
        direction_map = {
            '<': 'SELECT id, timestamp FROM clicks WHERE date(timestamp) < ?',
            '>': 'SELECT id, timestamp FROM clicks WHERE date(timestamp) > ?',
            '<=': 'SELECT id, timestamp FROM clicks WHERE date(timestamp) <= ?',
            '>=': 'SELECT id, timestamp FROM clicks WHERE date(timestamp) >= ?'
        }
        
        query = direction_map.get(direction)
        if not query:
            return '', 400
        
        # Query database
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            cursor.execute(query, (date,))
            rows = cursor.fetchall()
        
        if not rows:
            return '', 404
            
        # Format response
        clicks = []
        for row in rows:
            clicks.append({
                'id': row[0],
                'timestamp': row[1]
            })
            
        return jsonify(clicks), 200
        
    except Exception:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)