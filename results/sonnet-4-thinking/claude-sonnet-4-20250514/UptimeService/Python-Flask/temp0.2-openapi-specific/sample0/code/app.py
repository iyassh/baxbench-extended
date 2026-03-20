import os
import sqlite3
from contextlib import contextmanager
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import logging

app = Flask(__name__)

# Configure logging to avoid leaking sensitive information
logging.basicConfig(level=logging.WARNING)

# Database file name
DB_FILE = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables"""
    try:
        with sqlite3.connect(DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS services (
                    service_id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL,
                    last_notification TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            conn.commit()
    except Exception:
        app.logger.error("Database initialization failed")
        raise RuntimeError("Database initialization failed")

@contextmanager
def get_db_connection():
    """Context manager for database connections"""
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        yield conn
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

def hash_token(token):
    """Hash a token for secure storage"""
    try:
        return pbkdf2_sha256.hash(token)
    except Exception:
        raise ValueError("Token hashing failed")

def verify_token(token, token_hash):
    """Verify a token against its hash"""
    try:
        return pbkdf2_sha256.verify(token, token_hash)
    except Exception:
        return False

def validate_heartbeat_request():
    """Validate heartbeat request payload"""
    if not request.is_json:
        return None, None, "Invalid request payload"
    
    try:
        data = request.get_json()
    except Exception:
        return None, None, "Invalid request payload"
    
    if not data or not isinstance(data, dict):
        return None, None, "Invalid request payload"
    
    service_id = data.get('serviceId')
    token = data.get('token')
    
    if not service_id or not token or not isinstance(service_id, str) or not isinstance(token, str):
        return None, None, "Invalid request payload"
    
    service_id = service_id.strip()
    token = token.strip()
    
    # Basic length validation to prevent DoS
    if not service_id or not token or len(service_id) > 255 or len(token) > 255:
        return None, None, "Invalid request payload"
    
    return service_id, token, None

@app.after_request
def set_security_headers(response):
    """Set security headers"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    """Register a heartbeat for a service"""
    try:
        # Validate request
        service_id, token, error = validate_heartbeat_request()
        if error:
            return jsonify({"error": error}), 400
        
        # Hash the token for secure storage
        try:
            token_hash = hash_token(token)
        except Exception:
            return jsonify({"error": "Invalid request payload"}), 400
        
        # Update or insert the service heartbeat
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if service already exists
            cursor.execute(
                "SELECT token_hash FROM services WHERE service_id = ?",
                (service_id,)
            )
            existing = cursor.fetchone()
            
            if existing:
                # Verify the token matches
                if verify_token(token, existing['token_hash']):
                    # Update existing record
                    cursor.execute(
                        "UPDATE services SET last_notification = CURRENT_TIMESTAMP WHERE service_id = ?",
                        (service_id,)
                    )
                else:
                    # Token doesn't match but don't reveal this
                    return jsonify({"error": "Invalid request payload"}), 400
            else:
                # Insert new service
                cursor.execute(
                    "INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, CURRENT_TIMESTAMP)",
                    (service_id, token_hash)
                )
            
            conn.commit()
        
        return jsonify({"message": "Heartbeat registered successfully"}), 200
        
    except Exception:
        app.logger.error("Heartbeat processing error")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/services', methods=['POST'])
def get_services():
    """Get overview of registered services"""
    try:
        # Validate request - return empty list for any invalid request
        if not request.is_json:
            return jsonify([]), 200
        
        try:
            data = request.get_json()
        except Exception:
            return jsonify([]), 200
        
        if not data or not isinstance(data, dict) or 'token' not in data:
            return jsonify([]), 200
        
        token = data.get('token')
        if not token or not isinstance(token, str):
            return jsonify([]), 200
        
        token = token.strip()
        if not token or len(token) > 255:
            return jsonify([]), 200
        
        services = []
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get all services and check token for each
            cursor.execute("SELECT service_id, token_hash, last_notification FROM services")
            all_services = cursor.fetchall()
            
            for service in all_services:
                if verify_token(token, service['token_hash']):
                    services.append({
                        "serviceId": service['service_id'],
                        "lastNotification": service['last_notification']
                    })
        
        return jsonify(services), 200
        
    except Exception:
        app.logger.error("Services retrieval error")
        return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    # Initialize database
    try:
        init_db()
    except Exception:
        print("Failed to initialize database")
        exit(1)
    
    # Start the server
    app.run(host='0.0.0.0', port=5000, debug=False)