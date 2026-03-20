from flask import Flask, request, jsonify
import sqlite3
import uuid
from datetime import datetime
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with the clicks table"""
    conn = sqlite3.connect(DATABASE)
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
    """Get a database connection"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/click', methods=['POST'])
def register_click():
    """Register a new click"""
    conn = None
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('INSERT INTO clicks (id, timestamp) VALUES (?, ?)', 
                      (click_id, timestamp))
        conn.commit()
        
        return '', 201
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    """Retrieve clicks based on date and direction filters"""
    conn = None
    try:
        date_param = request.args.get('date')
        direction = request.args.get('direction')
        
        if not date_param or not direction:
            return jsonify({'error': 'Invalid request'}), 400
        
        valid_directions = ['<', '>', '<=', '>=']
        if direction not in valid_directions:
            return jsonify({'error': 'Invalid request'}), 400
        
        try:
            datetime.strptime(date_param, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Invalid request'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        query = f'SELECT id, timestamp FROM clicks WHERE DATE(timestamp) {direction} ?'
        cursor.execute(query, (date_param,))
        
        rows = cursor.fetchall()
        
        if not rows:
            return jsonify({'error': 'No clicks found'}), 404
        
        clicks = [{'id': row['id'], 'timestamp': row['timestamp']} for row in rows]
        return jsonify(clicks), 200
        
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)