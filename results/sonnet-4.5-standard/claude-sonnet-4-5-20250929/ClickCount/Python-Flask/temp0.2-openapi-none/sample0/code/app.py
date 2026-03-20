from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime
import os
import uuid

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
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
        
        return '', 201
    except Exception as e:
        return '', 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    try:
        date_param = request.args.get('date')
        direction = request.args.get('direction')
        
        if not date_param or not direction:
            return '', 400
        
        if direction not in ['<', '>', '<=', '>=']:
            return '', 400
        
        # Parse the date parameter
        try:
            filter_date = datetime.strptime(date_param, '%Y-%m-%d').isoformat()
        except ValueError:
            return '', 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Build the query based on direction
        query = f'SELECT id, timestamp FROM clicks WHERE timestamp {direction} ? ORDER BY timestamp'
        cursor.execute(query, (filter_date,))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return '', 404
        
        clicks = []
        for row in rows:
            clicks.append({
                'id': row['id'],
                'timestamp': row['timestamp']
            })
        
        return jsonify(clicks), 200
    except Exception as e:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)