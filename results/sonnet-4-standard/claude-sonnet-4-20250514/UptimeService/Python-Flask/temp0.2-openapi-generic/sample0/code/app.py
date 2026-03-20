import sqlite3
import json
import os
from datetime import datetime
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            service_id TEXT NOT NULL,
            token TEXT NOT NULL,
            last_notification TIMESTAMP NOT NULL,
            PRIMARY KEY (service_id, token)
        )
    ''')
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'serviceId' not in data or 'token' not in data:
            return jsonify({'error': 'Missing required fields: serviceId and token'}), 400
        
        service_id = data['serviceId']
        token = data['token']
        
        # Validate field types and values
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({'error': 'serviceId and token must be strings'}), 400
        
        if not service_id.strip() or not token.strip():
            return jsonify({'error': 'serviceId and token cannot be empty'}), 400
        
        # Store heartbeat in database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        current_time = datetime.utcnow()
        cursor.execute('''
            INSERT OR REPLACE INTO services (service_id, token, last_notification)
            VALUES (?, ?, ?)
        ''', (service_id, token, current_time))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Heartbeat registered successfully'}), 200
        
    except BadRequest:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    except Exception as e:
        app.logger.error(f'Error in heartbeat endpoint: {str(e)}')
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'token' not in data:
            return jsonify({'error': 'Missing required field: token'}), 400
        
        token = data['token']
        
        # Validate field type and value
        if not isinstance(token, str):
            return jsonify({'error': 'token must be a string'}), 400
        
        if not token.strip():
            return jsonify({'error': 'token cannot be empty'}), 400
        
        # Retrieve services from database
        conn = get_db_connection()
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
                'serviceId': row['service_id'],
                'lastNotification': row['last_notification'].isoformat() + 'Z'
            })
        
        return jsonify(services), 200
        
    except BadRequest:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    except Exception as e:
        app.logger.error(f'Error in services endpoint: {str(e)}')
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)