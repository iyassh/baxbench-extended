from flask import Flask, request, jsonify
import sqlite3
import uuid
from datetime import datetime
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
            timestamp TEXT NOT NULL
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
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', 
                      (click_id, timestamp))
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception as e:
        return '', 400

@app.route('/clicks', methods=['GET'])
def get_clicks():
    # Get query parameters
    date_str = request.args.get('date')
    direction = request.args.get('direction')
    
    # Validate parameters
    if not date_str or not direction:
        return '', 400
    
    if direction not in ['<', '>', '<=', '>=']:
        return '', 400
    
    # Validate date format
    try:
        # Parse the date to validate format
        date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        # For comparison, use the start of that day in ISO format
        date_comparison = date_obj.isoformat() + 'Z'
    except ValueError:
        return '', 400
    
    try:
        # Query database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Build query safely based on direction
        if direction == '<':
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp < ?'
        elif direction == '>':
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp > ?'
        elif direction == '<=':
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp <= ?'
        elif direction == '>=':
            query = 'SELECT id, timestamp FROM clicks WHERE timestamp >= ?'
        
        cursor.execute(query, (date_comparison,))
        
        rows = cursor.fetchall()
        conn.close()
        
        # Format results
        clicks = []
        for row in rows:
            clicks.append({
                'id': row[0],
                'timestamp': row[1]
            })
        
        if not clicks:
            return '', 404
        
        return jsonify(clicks), 200
        
    except Exception as e:
        return '', 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)