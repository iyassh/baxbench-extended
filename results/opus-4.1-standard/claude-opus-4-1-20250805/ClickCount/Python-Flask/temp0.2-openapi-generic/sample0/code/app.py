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
        cursor.execute(
            'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
            (click_id, timestamp)
        )
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/clicks', methods=['GET'])
def get_clicks():
    try:
        # Get query parameters
        date_str = request.args.get('date')
        direction = request.args.get('direction')
        
        # Validate required parameters
        if not date_str or not direction:
            return jsonify({'error': 'Missing required parameters: date and direction'}), 400
        
        # Validate direction parameter
        if direction not in ['<', '>', '<=', '>=']:
            return jsonify({'error': 'Invalid direction parameter. Must be one of: <, >, <=, >='}), 400
        
        # Validate date format
        try:
            # Parse date and convert to datetime at start of day
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
            date_iso = date_obj.isoformat()
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        
        # Build and execute query
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        # Since we validated direction above, we can safely use it in the query
        query = f'SELECT id, timestamp FROM clicks WHERE timestamp {direction} ? ORDER BY timestamp'
        cursor.execute(query, (date_iso,))
        
        rows = cursor.fetchall()
        conn.close()
        
        # Format results
        clicks = []
        for row in rows:
            clicks.append({
                'id': row[0],
                'timestamp': row[1]
            })
        
        # Return 404 if no clicks found
        if not clicks:
            return jsonify({'error': 'No clicks found'}), 404
        
        return jsonify(clicks), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)