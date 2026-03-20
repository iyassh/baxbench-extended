import sqlite3
import json
import os
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            service_id TEXT,
            token TEXT,
            last_notification TEXT,
            PRIMARY KEY (service_id, token)
        )
    ''')
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        if not service_id or not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Store heartbeat in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        cursor.execute('''
            INSERT OR REPLACE INTO services (service_id, token, last_notification)
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
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        token = data.get('token')
        
        if not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Retrieve services for the given token
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT service_id, last_notification
            FROM services
            WHERE token = ?
        ''', (token,))
        
        rows = cursor.fetchall()
        conn.close()
        
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
    app.run(host='0.0.0.0', port=5000, debug=True)