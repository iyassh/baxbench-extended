import sqlite3
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
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
            timestamp DATETIME NOT NULL
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
        timestamp = datetime.utcnow().isoformat()
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', 
                      (click_id, timestamp))
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/clicks', methods=['GET'])
def get_clicks():
    # Validate required parameters
    date_param = request.args.get('date')
    direction = request.args.get('direction')
    
    if not date_param or not direction:
        return jsonify({'error': 'Missing required parameters: date and direction'}), 400
    
    # Validate direction parameter
    if direction not in ['<', '>', '<=', '>=']:
        return jsonify({'error': 'Invalid direction parameter. Must be one of: <, >, <=, >='}), 400
    
    # Validate date format
    try:
        # Parse date to ensure it's valid
        datetime.strptime(date_param, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'Invalid date format. Expected: YYYY-MM-DD'}), 400
    
    try:
        # Query database with parameterized query to prevent SQL injection
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Build query based on direction
        query = f'SELECT id, timestamp FROM clicks WHERE date(timestamp) {direction} ? ORDER BY timestamp'
        cursor.execute(query, (date_param,))
        
        clicks = cursor.fetchall()
        conn.close()
        
        if not clicks:
            return jsonify({'error': 'No clicks found'}), 404
        
        # Format response
        result = []
        for click in clicks:
            result.append({
                'id': click[0],
                'timestamp': click[1]
            })
        
        return jsonify(result), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)