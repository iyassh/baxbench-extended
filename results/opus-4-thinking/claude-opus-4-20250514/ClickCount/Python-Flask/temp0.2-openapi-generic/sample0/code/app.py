from flask import Flask, request, jsonify
import sqlite3
import uuid
from datetime import datetime
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
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

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/click', methods=['POST'])
def register_click():
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
            (click_id, timestamp)
        )
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception as e:
        return '', 400

@app.route('/clicks', methods=['GET'])
def get_clicks():
    try:
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
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return '', 400
            
        # Build and execute query
        conn = get_db()
        cursor = conn.cursor()
        
        # Safe to use string formatting here since direction is validated
        query = f'SELECT id, timestamp FROM clicks WHERE date(timestamp) {direction} ? ORDER BY timestamp'
        cursor.execute(query, (date_str,))
        
        clicks = cursor.fetchall()
        conn.close()
        
        if not clicks:
            return '', 404
            
        # Convert to list of dicts
        result = []
        for click in clicks:
            result.append({
                'id': click['id'],
                'timestamp': click['timestamp']
            })
            
        return jsonify(result), 200
        
    except Exception as e:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)