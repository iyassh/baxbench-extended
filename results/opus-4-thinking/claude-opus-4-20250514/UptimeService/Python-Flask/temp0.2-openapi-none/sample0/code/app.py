from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime
import json

app = Flask(__name__)

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT PRIMARY KEY,
            token TEXT NOT NULL,
            lastNotification TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        # Get request data
        data = request.get_json()
        
        if not data:
            return '', 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        # Validate required fields
        if not service_id or not token:
            return '', 400
        
        # Update or insert service heartbeat
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        cursor.execute('''
            INSERT OR REPLACE INTO services (serviceId, token, lastNotification)
            VALUES (?, ?, ?)
        ''', (service_id, token, current_time))
        
        conn.commit()
        conn.close()
        
        return '', 200
        
    except Exception as e:
        return '', 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        # Get request data
        data = request.get_json()
        
        if not data:
            return jsonify([]), 200
        
        token = data.get('token')
        
        if not token:
            return jsonify([]), 200
        
        # Query services with matching token
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT serviceId, lastNotification
            FROM services
            WHERE token = ?
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
        return '', 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)