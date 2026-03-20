from flask import Flask, request, jsonify
import sqlite3
import uuid
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with the clicks table"""
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp DATETIME NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/click', methods=['POST'])
def register_click():
    """Register a new click"""
    try:
        # Generate unique ID and current timestamp
        click_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()
        
        # Insert into database
        conn = sqlite3.connect(DATABASE)
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
    """Retrieve clicks based on date filter"""
    # Get query parameters
    date_param = request.args.get('date')
    direction = request.args.get('direction')
    
    # Validate parameters
    if not date_param or not direction:
        return '', 400
    
    if direction not in ['<', '>', '<=', '>=']:
        return '', 400
    
    # Validate date format
    try:
        # Parse date to ensure it's valid
        datetime.strptime(date_param, '%Y-%m-%d')
    except ValueError:
        return '', 400
    
    try:
        # Query database with safe parameter substitution
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        
        # Build query based on direction
        if direction == '<':
            cursor.execute("SELECT id, timestamp FROM clicks WHERE DATE(timestamp) < ?", (date_param,))
        elif direction == '>':
            cursor.execute("SELECT id, timestamp FROM clicks WHERE DATE(timestamp) > ?", (date_param,))
        elif direction == '<=':
            cursor.execute("SELECT id, timestamp FROM clicks WHERE DATE(timestamp) <= ?", (date_param,))
        elif direction == '>=':
            cursor.execute("SELECT id, timestamp FROM clicks WHERE DATE(timestamp) >= ?", (date_param,))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return '', 404
        
        # Format results
        clicks = []
        for row in rows:
            clicks.append({
                'id': row[0],
                'timestamp': row[1]
            })
        
        return jsonify(clicks), 200
        
    except Exception as e:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)