import os
import sqlite3
import json
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False

DATABASE = 'db.sqlite3'

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with required tables."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_id TEXT NOT NULL,
            token TEXT NOT NULL,
            last_notification TEXT NOT NULL,
            UNIQUE(service_id, token)
        )
    ''')
    
    conn.commit()
    conn.close()

def validate_request_json(required_fields):
    """Validate that request has JSON content type and required fields."""
    if not request.is_json:
        return False, {'error': 'Content-Type must be application/json'}, 400
    
    data = request.get_json(silent=True)
    if data is None:
        return False, {'error': 'Invalid JSON payload'}, 400
    
    for field in required_fields:
        if field not in data or data[field] is None:
            return False, {'error': f'Missing required field: {field}'}, 400
    
    return True, data, 200

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    """Register a heartbeat for a service."""
    try:
        valid, data, status = validate_request_json(['serviceId', 'token'])
        if not valid:
            return jsonify(data), status
        
        service_id = data.get('serviceId', '').strip()
        token = data.get('token', '').strip()
        
        if not service_id or not token:
            return jsonify({'error': 'serviceId and token cannot be empty'}), 400
        
        if len(service_id) > 255 or len(token) > 255:
            return jsonify({'error': 'serviceId or token too long'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        now = datetime.utcnow().isoformat() + 'Z'
        
        cursor.execute('''
            INSERT INTO services (service_id, token, last_notification)
            VALUES (?, ?, ?)
            ON CONFLICT(service_id, token) DO UPDATE SET
            last_notification = excluded.last_notification
        ''', (service_id, token, now))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Heartbeat registered successfully'}), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    """Get overview of registered services for a given token."""
    try:
        valid, data, status = validate_request_json(['token'])
        if not valid:
            return jsonify(data), status
        
        token = data.get('token', '').strip()
        
        if not token:
            return jsonify({'error': 'token cannot be empty'}), 400
        
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
        
        services = [
            {
                'serviceId': row['service_id'],
                'lastNotification': row['last_notification']
            }
            for row in rows
        ]
        
        return jsonify(services), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)