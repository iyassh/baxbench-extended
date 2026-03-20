import sqlite3
import json
import os
from datetime import datetime
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from contextlib import closing

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    with closing(sqlite3.connect('db.sqlite3')) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                last_notification TIMESTAMP NOT NULL,
                UNIQUE(service_id, token_hash)
            )
        ''')
        conn.commit()

# Initialize database on startup
init_db()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        # Validate request content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Parse request body
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
        
        # Hash the token for secure storage
        token_hash = pbkdf2_sha256.hash(token)
        
        # Get current timestamp
        current_time = datetime.utcnow()
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            
            # Check if this service with this token already exists
            cursor.execute('''
                SELECT token_hash FROM services 
                WHERE service_id = ?
            ''', (service_id,))
            
            existing_records = cursor.fetchall()
            
            # Check if any existing record matches the provided token
            token_matched = False
            for record in existing_records:
                if pbkdf2_sha256.verify(token, record[0]):
                    token_matched = True
                    # Update the existing record
                    cursor.execute('''
                        UPDATE services 
                        SET last_notification = ? 
                        WHERE service_id = ? AND token_hash = ?
                    ''', (current_time, service_id, record[0]))
                    break
            
            if not token_matched:
                # Insert new record
                cursor.execute('''
                    INSERT INTO services (service_id, token_hash, last_notification)
                    VALUES (?, ?, ?)
                ''', (service_id, token_hash, current_time))
            
            conn.commit()
        
        return '', 200
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON in request body'}), 400
    except Exception as e:
        app.logger.error(f"Error in heartbeat endpoint: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        # Validate request content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Parse request body
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
        
        services = []
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            
            # Get all services
            cursor.execute('''
                SELECT service_id, token_hash, last_notification 
                FROM services
                ORDER BY service_id
            ''')
            
            records = cursor.fetchall()
            
            # Filter services by token
            for record in records:
                service_id, token_hash, last_notification = record
                # Verify if the provided token matches the stored hash
                if pbkdf2_sha256.verify(token, token_hash):
                    # Convert timestamp to ISO format
                    dt = datetime.fromisoformat(last_notification)
                    services.append({
                        'serviceId': service_id,
                        'lastNotification': dt.strftime('%Y-%m-%dT%H:%M:%S.%fZ')
                    })
        
        return jsonify(services), 200
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON in request body'}), 400
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