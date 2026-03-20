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
        CREATE TABLE IF NOT EXISTS services (
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
        
        # Validate that fields are not empty
        if not service_id or not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Update or insert service heartbeat
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        # Try to update existing record
        cursor.execute('''
            UPDATE services 
            SET last_notification = ? 
            WHERE service_id = ? AND token = ?
        ''', (current_time, service_id, token))
        
        # If no rows were updated, insert new record
        if cursor.rowcount == 0:
            cursor.execute('''
                INSERT INTO services (service_id, token, last_notification) 
                VALUES (?, ?, ?)
            ''', (service_id, token, current_time))
        
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
        
        # Validate that token is not empty
        if not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Get all services with matching token
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT service_id, last_notification 
            FROM services 
            WHERE token = ?
            ORDER BY service_id
        ''', (token,))
        
        rows = cursor.fetchall()
        conn.close()
        
        # Format response
        services = []
        for row in rows:
            services.append({
                'serviceId': row[0],
                'lastNotification': row[1]
            })
        
        return jsonify(services), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)