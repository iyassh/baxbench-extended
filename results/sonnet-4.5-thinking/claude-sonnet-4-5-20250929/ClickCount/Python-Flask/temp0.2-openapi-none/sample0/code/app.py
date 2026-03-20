from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime
import uuid

app = Flask(__name__)

# Database setup
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

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/click', methods=['POST'])
def register_click():
    try:
        # Generate a unique ID and current timestamp
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
        
        # Insert into database
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', (click_id, timestamp))
            conn.commit()
        finally:
            conn.close()
        
        return '', 201
    except Exception:
        return '', 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    try:
        # Get query parameters
        date_str = request.args.get('date')
        direction = request.args.get('direction')
        
        # Validate parameters
        if not date_str or not direction:
            return '', 400
        
        # Whitelist validation for direction
        valid_directions = ['<', '>', '<=', '>=']
        if direction not in valid_directions:
            return '', 400
        
        # Parse the date
        try:
            filter_date = datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return '', 400
        
        # Build SQL query
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            
            # Convert date to ISO format for comparison (with Z suffix for UTC)
            filter_date_iso = filter_date.isoformat() + 'Z'
            
            # Use string formatting for operator (safe because of whitelist validation)
            query = f'SELECT id, timestamp FROM clicks WHERE timestamp {direction} ?'
            cursor.execute(query, (filter_date_iso,))
            
            rows = cursor.fetchall()
        finally:
            conn.close()
        
        # If no clicks found, return 404
        if not rows:
            return '', 404
        
        # Format results
        clicks = []
        for row in rows:
            clicks.append({
                'id': row['id'],
                'timestamp': row['timestamp']
            })
        
        return jsonify(clicks), 200
    except Exception:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)