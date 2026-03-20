from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime
import hashlib
from werkzeug.exceptions import BadRequest

app = Flask(__name__)

# Database setup
DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables"""
    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        
        # Create table for service heartbeats
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS services (
                service_id TEXT PRIMARY KEY,
                token_hash TEXT NOT NULL,
                last_notification TEXT NOT NULL
            )
        ''')
        
        conn.commit()

def hash_token(token):
    """Hash a token using SHA-256"""
    return hashlib.sha256(token.encode()).hexdigest()

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    """Register a heartbeat for a service"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Invalid request'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'serviceId' not in data or 'token' not in data:
            return jsonify({'error': 'Invalid request'}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        # Validate types
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate non-empty
        if not service_id or not token:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Hash the token
        token_hash = hash_token(token)
        
        # Get current timestamp
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        # Store in database using parameterized query
        with sqlite3.connect(DB_NAME) as conn:
            cursor = conn.cursor()
            
            # Insert or update the heartbeat
            cursor.execute('''
                INSERT INTO services (service_id, token_hash, last_notification)
                VALUES (?, ?, ?)
                ON CONFLICT(service_id) DO UPDATE SET
                    token_hash = excluded.token_hash,
                    last_notification = excluded.last_notification
            ''', (service_id, token_hash, current_time))
            
            conn.commit()
        
        return '', 200
        
    except BadRequest:
        # Handle JSON parsing errors
        return jsonify({'error': 'Invalid request'}), 400
    except Exception:
        # Return generic error without exposing details
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    """Get overview of registered services"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Internal server error'}), 500
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'token' not in data:
            return jsonify({'error': 'Internal server error'}), 500
        
        token = data.get('token')
        
        # Validate type
        if not isinstance(token, str):
            return jsonify({'error': 'Internal server error'}), 500
        
        # Validate non-empty
        if not token:
            return jsonify({'error': 'Internal server error'}), 500
        
        # Hash the token
        token_hash = hash_token(token)
        
        # Query database using parameterized query
        with sqlite3.connect(DB_NAME) as conn:
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT service_id, last_notification
                FROM services
                WHERE token_hash = ?
            ''', (token_hash,))
            
            rows = cursor.fetchall()
        
        # Build response
        services = []
        for row in rows:
            services.append({
                'serviceId': row[0],
                'lastNotification': row[1]
            })
        
        return jsonify(services), 200
        
    except Exception:
        # Return generic error without exposing details
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the app
    app.run(host='0.0.0.0', port=5000)