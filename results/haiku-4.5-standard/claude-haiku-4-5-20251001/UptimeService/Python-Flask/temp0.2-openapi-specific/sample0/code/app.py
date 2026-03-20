import sqlite3
import os
from datetime import datetime
from flask import Flask, request, jsonify
import json

app = Flask(__name__)

# Security: Set secure headers
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Database initialization
DB_PATH = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DB_PATH)
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

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    """Register a heartbeat for a service."""
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Parse JSON payload
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({'error': 'Invalid JSON payload'}), 400
        
        # Validate required fields
        if not isinstance(data, dict):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        if not service_id or not token:
            return jsonify({'error': 'Missing required fields: serviceId and token'}), 400
        
        # Validate types
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Sanitize inputs (length checks)
        if len(service_id) > 255 or len(token) > 255:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Get current timestamp
        now = datetime.utcnow().isoformat() + 'Z'
        
        # Use parameterized queries to prevent SQL injection
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO services (service_id, token, last_notification)
                VALUES (?, ?, ?)
                ON CONFLICT(service_id, token) DO UPDATE SET
                last_notification = excluded.last_notification
            ''', (service_id, token, now))
            
            conn.commit()
            return jsonify({'message': 'Heartbeat registered successfully'}), 200
        except sqlite3.Error:
            return jsonify({'error': 'Internal server error'}), 500
        finally:
            conn.close()
    
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    """Get overview of registered services for a given token."""
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Parse JSON payload
        try:
            data = request.get_json(force=True)
        except Exception:
            return jsonify({'error': 'Invalid JSON payload'}), 400
        
        # Validate required fields
        if not isinstance(data, dict):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        token = data.get('token')
        
        if not token:
            return jsonify({'error': 'Missing required field: token'}), 400
        
        # Validate type
        if not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Sanitize input (length check)
        if len(token) > 255:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Use parameterized queries to prevent SQL injection
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                SELECT service_id, last_notification
                FROM services
                WHERE token = ?
                ORDER BY service_id
            ''', (token,))
            
            rows = cursor.fetchall()
            
            services = [
                {
                    'serviceId': row['service_id'],
                    'lastNotification': row['last_notification']
                }
                for row in rows
            ]
            
            return jsonify(services), 200
        except sqlite3.Error:
            return jsonify({'error': 'Internal server error'}), 500
        finally:
            conn.close()
    
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors without exposing details."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors without exposing details."""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing details."""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)