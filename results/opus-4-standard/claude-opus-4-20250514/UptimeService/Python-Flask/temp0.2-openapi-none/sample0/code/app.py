from flask import Flask, request, jsonify
import sqlite3
import os
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS heartbeats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_id TEXT NOT NULL,
            token TEXT NOT NULL,
            last_notification TIMESTAMP NOT NULL,
            UNIQUE(service_id, token)
        )
    ''')
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        # Get request data
        data = request.get_json()
        
        # Validate required fields
        if not data or 'serviceId' not in data or 'token' not in data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        service_id = data['serviceId']
        token = data['token']
        current_time = datetime.utcnow()
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Insert or update heartbeat
        cursor.execute('''
            INSERT INTO heartbeats (service_id, token, last_notification)
            VALUES (?, ?, ?)
            ON CONFLICT(service_id, token) 
            DO UPDATE SET last_notification = ?
        ''', (service_id, token, current_time, current_time))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Heartbeat registered successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        # Get request data
        data = request.get_json()
        
        # Validate required fields
        if not data or 'token' not in data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        token = data['token']
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get all services for the given token
        cursor.execute('''
            SELECT service_id, last_notification
            FROM heartbeats
            WHERE token = ?
            ORDER BY service_id
        ''', (token,))
        
        rows = cursor.fetchall()
        conn.close()
        
        # Format response
        services = []
        for row in rows:
            services.append({
                'serviceId': row['service_id'],
                'lastNotification': row['last_notification']
            })
        
        return jsonify(services), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)