from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime
import uuid
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'dev-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    conn.execute('''
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
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        conn = get_db_connection()
        conn.execute(
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
        date_param = request.args.get('date')
        direction = request.args.get('direction')
        
        if not date_param or not direction:
            return '', 400
        
        if direction not in ['<', '>', '<=', '>=']:
            return '', 400
        
        # Validate date format
        try:
            datetime.strptime(date_param, '%Y-%m-%d')
        except ValueError:
            return '', 400
        
        conn = get_db_connection()
        
        # Build query with validated direction operator
        query = f'SELECT id, timestamp FROM clicks WHERE DATE(timestamp) {direction} ?'
        
        cursor = conn.execute(query, (date_param,))
        clicks = cursor.fetchall()
        conn.close()
        
        if not clicks:
            return '', 404
        
        result = [
            {
                'id': click['id'],
                'timestamp': click['timestamp']
            }
            for click in clicks
        ]
        
        return jsonify(result), 200
    except Exception as e:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)