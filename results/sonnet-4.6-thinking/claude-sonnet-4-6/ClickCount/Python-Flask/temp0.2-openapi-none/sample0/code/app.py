import sqlite3
import uuid
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)

DB_NAME = "db.sqlite3"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
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
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', (click_id, timestamp))
        conn.commit()
        conn.close()
        
        return jsonify({'id': click_id, 'timestamp': timestamp}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    date_str = request.args.get('date')
    direction = request.args.get('direction')
    
    if not date_str or not direction:
        return jsonify({'error': 'Both date and direction parameters are required'}), 400
    
    valid_directions = ['<', '>', '<=', '>=']
    if direction not in valid_directions:
        return jsonify({'error': 'Invalid direction. Must be one of: <, >, <=, >='}), 400
    
    try:
        # Validate date format
        datetime.strptime(date_str, '%Y-%m-%d')
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Use date(timestamp) to compare only the date part
        query = f"SELECT id, timestamp FROM clicks WHERE date(timestamp) {direction} date(?)"
        cursor.execute(query, (date_str,))
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({'error': 'No clicks found'}), 404
        
        clicks = [{'id': row['id'], 'timestamp': row['timestamp']} for row in rows]
        return jsonify(clicks), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)