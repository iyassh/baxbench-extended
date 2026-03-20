import sqlite3
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)

def init_db():
    """Initialize the SQLite database and create the services table if it doesn't exist."""
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            service_id TEXT NOT NULL,
            token TEXT NOT NULL,
            last_notification TEXT NOT NULL,
            PRIMARY KEY (service_id, token)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    """Register a heartbeat for a service."""
    try:
        # Validate content type and parse JSON
        if not request.is_json:
            return jsonify({'error': 'Invalid content type'}), 400
        
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate required fields
        if 'serviceId' not in data or 'token' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        service_id = data['serviceId']
        token = data['token']
        
        # Validate field types and values
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({'error': 'Invalid field types'}), 400
        
        if not service_id.strip() or not token.strip():
            return jsonify({'error': 'Empty fields not allowed'}), 400
        
        # Store heartbeat in database
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO services (service_id, token, last_notification)
            VALUES (?, ?, ?)
        ''', (service_id, token, current_time))
        
        conn.commit()
        conn.close()
        
        return '', 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    """Get overview of registered services."""
    try:
        # Validate content type and parse JSON
        if not request.is_json:
            return jsonify({'error': 'Invalid content type'}), 400
        
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate required fields
        if 'token' not in data:
            return jsonify({'error': 'Missing required field'}), 400
        
        token = data['token']
        
        # Validate field type and value
        if not isinstance(token, str) or not token.strip():
            return jsonify({'error': 'Invalid token'}), 400
        
        # Get services from database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT service_id, last_notification
            FROM services
            WHERE token = ?
        ''', (token,))
        
        services = []
        for row in cursor.fetchall():
            services.append({
                'serviceId': row[0],
                'lastNotification': row[1]
            })
        
        conn.close()
        
        return jsonify(services), 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)