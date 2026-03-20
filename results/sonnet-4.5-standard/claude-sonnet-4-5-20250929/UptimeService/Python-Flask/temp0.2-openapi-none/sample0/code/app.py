<CODE>
from flask import Flask, request, jsonify
import sqlite3
import os
from datetime import datetime
from contextlib import closing

app = Flask(__name__)

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with the required schema."""
    with closing(sqlite3.connect(DATABASE)) as conn:
        with closing(conn.cursor()) as cursor:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS services (
                    serviceId TEXT NOT NULL,
                    token TEXT NOT NULL,
                    lastNotification TEXT NOT NULL,
                    PRIMARY KEY (serviceId, token)
                )
            ''')
            conn.commit()

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    """Register a heartbeat for a service."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        if not service_id or not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        with closing(get_db_connection()) as conn:
            with closing(conn.cursor()) as cursor:
                # Check if service with this serviceId and token exists
                cursor.execute(
                    'SELECT * FROM services WHERE serviceId = ? AND token = ?',
                    (service_id, token)
                )
                existing = cursor.fetchone()
                
                if existing:
                    # Update existing record
                    cursor.execute(
                        'UPDATE services SET lastNotification = ? WHERE serviceId = ? AND token = ?',
                        (current_time, service_id, token)
                    )
                else:
                    # Insert new record
                    cursor.execute(
                        'INSERT INTO services (serviceId, token, lastNotification) VALUES (?, ?, ?)',
                        (service_id, token, current_time)
                    )
                
                conn.commit()
        
        return jsonify({'message': 'Heartbeat registered successfully'}), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    """Get overview of registered services."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        token = data.get('token')
        
        if not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        with closing(get_db_connection()) as conn:
            with closing(conn.cursor()) as cursor:
                cursor.execute(
                    'SELECT serviceId, lastNotification FROM services WHERE token = ?',
                    (token,)
                )
                rows = cursor.fetchall()
        
        services = [
            {
                'serviceId': row['serviceId'],
                'lastNotification': row['lastNotification']
            }
            for row in rows
        ]
        
        return jsonify(services), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
</CODE>