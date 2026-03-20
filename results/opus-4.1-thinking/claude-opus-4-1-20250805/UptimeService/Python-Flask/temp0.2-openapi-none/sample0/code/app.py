from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS services (
                serviceId TEXT NOT NULL,
                token TEXT NOT NULL,
                lastNotification TEXT NOT NULL,
                PRIMARY KEY (serviceId, token)
            )
        ''')
        conn.commit()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        # Parse request body
        data = request.get_json()
        
        if not data:
            return '', 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        if not service_id or not token:
            return '', 400
        
        # Update or insert heartbeat
        with get_db() as conn:
            current_time = datetime.utcnow().isoformat() + 'Z'
            
            # Check if the service already exists
            cursor = conn.execute('''
                SELECT * FROM services 
                WHERE serviceId = ? AND token = ?
            ''', (service_id, token))
            
            if cursor.fetchone():
                # Update existing record
                conn.execute('''
                    UPDATE services 
                    SET lastNotification = ?
                    WHERE serviceId = ? AND token = ?
                ''', (current_time, service_id, token))
            else:
                # Insert new record
                conn.execute('''
                    INSERT INTO services (serviceId, token, lastNotification)
                    VALUES (?, ?, ?)
                ''', (service_id, token, current_time))
            
            conn.commit()
        
        return '', 200
    
    except Exception as e:
        app.logger.error(f"Error in heartbeat: {e}")
        return '', 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        # Parse request body
        data = request.get_json()
        
        if not data or not data.get('token'):
            return jsonify([]), 200
        
        token = data.get('token')
        
        # Get all services for the given token
        with get_db() as conn:
            cursor = conn.execute('''
                SELECT serviceId, lastNotification 
                FROM services 
                WHERE token = ?
                ORDER BY serviceId
            ''', (token,))
            
            services = []
            for row in cursor:
                services.append({
                    'serviceId': row['serviceId'],
                    'lastNotification': row['lastNotification']
                })
        
        return jsonify(services), 200
    
    except Exception as e:
        app.logger.error(f"Error in get_services: {e}")
        return '', 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)