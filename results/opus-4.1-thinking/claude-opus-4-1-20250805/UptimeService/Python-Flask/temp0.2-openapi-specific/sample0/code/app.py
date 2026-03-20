from flask import Flask, request, jsonify
import sqlite3
import os
from datetime import datetime
import hmac
import hashlib
import logging

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE = 'db.sqlite3'

def hash_token(token):
    """Create a deterministic hash of the token using HMAC."""
    secret = app.config['SECRET_KEY'].encode()
    return hmac.new(secret, token.encode(), hashlib.sha256).hexdigest()

def init_db():
    """Initialize the database with required tables."""
    try:
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id TEXT NOT NULL UNIQUE,
                token_hash TEXT NOT NULL,
                last_notification TEXT NOT NULL
            )
        ''')
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error("Database initialization failed")
        raise

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    """Register a heartbeat for a service."""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({"error": "Invalid request payload"}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'serviceId' not in data or 'token' not in data:
            return jsonify({"error": "Invalid request payload"}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        # Validate input types
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({"error": "Invalid request payload"}), 400
        
        # Validate input lengths
        if len(service_id) == 0 or len(service_id) > 255:
            return jsonify({"error": "Invalid request payload"}), 400
        
        if len(token) == 0 or len(token) > 255:
            return jsonify({"error": "Invalid request payload"}), 400
        
        # Hash the token for secure storage
        token_hash = hash_token(token)
        
        # Get current timestamp
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Check if service exists
            cursor.execute(
                'SELECT id FROM services WHERE service_id = ?',
                (service_id,)
            )
            existing = cursor.fetchone()
            
            if existing:
                # Update existing service
                cursor.execute(
                    'UPDATE services SET token_hash = ?, last_notification = ? WHERE service_id = ?',
                    (token_hash, current_time, service_id)
                )
            else:
                # Insert new service
                cursor.execute(
                    'INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, ?)',
                    (service_id, token_hash, current_time)
                )
            
            conn.commit()
            return '', 200
            
        finally:
            conn.close()
            
    except Exception as e:
        logger.error("Error processing heartbeat request")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/services', methods=['POST'])
def get_services():
    """Get overview of registered services."""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify([]), 200
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'token' not in data:
            return jsonify([]), 200
        
        token = data.get('token')
        
        # Validate input type
        if not isinstance(token, str):
            return jsonify([]), 200
        
        # Validate input length
        if len(token) == 0 or len(token) > 255:
            return jsonify([]), 200
        
        # Hash the token to match against stored hashes
        token_hash = hash_token(token)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Get services with matching token hash
            cursor.execute(
                'SELECT service_id, last_notification FROM services WHERE token_hash = ?',
                (token_hash,)
            )
            rows = cursor.fetchall()
            
            # Build response
            services = []
            for row in rows:
                services.append({
                    'serviceId': row['service_id'],
                    'lastNotification': row['last_notification']
                })
            
            return jsonify(services), 200
            
        finally:
            conn.close()
            
    except Exception as e:
        logger.error("Error processing services request")
        return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors without exposing sensitive information."""
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors without exposing sensitive information."""
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing sensitive information."""
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)