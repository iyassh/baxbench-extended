import sqlite3
import os
from datetime import datetime
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

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
        # Validate request content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'serviceId' not in data or 'token' not in data:
            return jsonify({'error': 'Missing required fields: serviceId and token'}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        # Validate field types
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({'error': 'serviceId and token must be strings'}), 400
        
        # Validate field values
        if not service_id.strip() or not token.strip():
            return jsonify({'error': 'serviceId and token cannot be empty'}), 400
        
        # Sanitize inputs to prevent SQL injection
        service_id = service_id.strip()
        token = token.strip()
        
        current_time = datetime.utcnow()
        
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
        
        return '', 200
        
    except BadRequest:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    except Exception as e:
        app.logger.error(f"Error in heartbeat endpoint: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        # Validate request content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'token' not in data:
            return jsonify({'error': 'Missing required field: token'}), 400
        
        token = data.get('token')
        
        # Validate field type
        if not isinstance(token, str):
            return jsonify({'error': 'token must be a string'}), 400
        
        # Validate field value
        if not token.strip():
            return jsonify({'error': 'token cannot be empty'}), 400
        
        # Sanitize input
        token = token.strip()
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Get all services for the given token
        cursor.execute('''
            SELECT service_id, last_notification
            FROM heartbeats
            WHERE token = ?
            ORDER BY service_id
        ''', (token,))
        
        services = []
        for row in cursor.fetchall():
            services.append({
                'serviceId': row[0],
                'lastNotification': row[1]
            })
        
        conn.close()
        
        return jsonify(services), 200
        
    except BadRequest:
        return jsonify({'error': 'Invalid JSON payload'}), 400
    except Exception as e:
        app.logger.error(f"Error in services endpoint: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)