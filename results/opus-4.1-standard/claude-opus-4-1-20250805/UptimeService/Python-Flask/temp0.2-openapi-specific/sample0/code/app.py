import os
import sqlite3
import hashlib
import hmac
from datetime import datetime
from flask import Flask, request, jsonify, make_response
from werkzeug.exceptions import BadRequest, InternalServerError
import logging

# Configure logging to avoid exposing sensitive information
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

# Database initialization
DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        
        # Create services table with proper schema
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                last_notification TIMESTAMP,
                UNIQUE(service_id, token_hash)
            )
        ''')
        
        # Create index for better query performance
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_token_hash 
            ON services(token_hash)
        ''')
        
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error("Database initialization failed")
        raise

def hash_token(token):
    """Securely hash tokens using HMAC with app secret."""
    if not token:
        return None
    secret = app.config['SECRET_KEY'].encode()
    return hmac.new(secret, token.encode(), hashlib.sha256).hexdigest()

def get_db_connection():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def add_security_headers(response):
    """Add security headers to response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.after_request
def after_request(response):
    """Apply security headers to all responses."""
    return add_security_headers(response)

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all exceptions to avoid information leakage."""
    if isinstance(e, BadRequest):
        return jsonify({'error': 'Invalid request'}), 400
    
    # Log the actual error for debugging but don't expose it
    logger.error(f"Unhandled exception: {type(e).__name__}")
    return jsonify({'error': 'Internal server error'}), 500

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    """Register a heartbeat for a service."""
    try:
        # Validate request content type
        if not request.is_json:
            return jsonify({'error': 'Invalid request'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'serviceId' not in data or 'token' not in data:
            return jsonify({'error': 'Invalid request'}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        # Validate input types and lengths
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({'error': 'Invalid request'}), 400
        
        if len(service_id) > 255 or len(token) > 255:
            return jsonify({'error': 'Invalid request'}), 400
        
        if not service_id.strip() or not token.strip():
            return jsonify({'error': 'Invalid request'}), 400
        
        # Hash the token for secure storage
        token_hash = hash_token(token)
        current_time = datetime.utcnow().isoformat()
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Use parameterized queries to prevent SQL injection
            cursor.execute('''
                INSERT INTO services (service_id, token_hash, last_notification)
                VALUES (?, ?, ?)
                ON CONFLICT(service_id, token_hash) 
                DO UPDATE SET last_notification = ?
            ''', (service_id, token_hash, current_time, current_time))
            
            conn.commit()
            return jsonify({'message': 'Heartbeat registered successfully'}), 200
            
        except sqlite3.Error:
            logger.error("Database operation failed")
            return jsonify({'error': 'Internal server error'}), 500
        finally:
            conn.close()
            
    except Exception:
        logger.error("Unexpected error in heartbeat endpoint")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    """Get overview of registered services."""
    try:
        # Validate request content type
        if not request.is_json:
            return jsonify({'error': 'Invalid request'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'token' not in data:
            return jsonify({'error': 'Invalid request'}), 400
        
        token = data.get('token')
        
        # Validate input type and length
        if not isinstance(token, str):
            return jsonify({'error': 'Invalid request'}), 400
        
        if len(token) > 255:
            return jsonify({'error': 'Invalid request'}), 400
        
        if not token.strip():
            return jsonify({'error': 'Invalid request'}), 400
        
        # Hash the token to match stored values
        token_hash = hash_token(token)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Use parameterized query to prevent SQL injection
            cursor.execute('''
                SELECT service_id, last_notification
                FROM services
                WHERE token_hash = ?
                ORDER BY service_id
            ''', (token_hash,))
            
            rows = cursor.fetchall()
            
            # Format response
            services = []
            for row in rows:
                services.append({
                    'serviceId': row['service_id'],
                    'lastNotification': row['last_notification']
                })
            
            return jsonify(services), 200
            
        except sqlite3.Error:
            logger.error("Database operation failed")
            return jsonify({'error': 'Internal server error'}), 500
        finally:
            conn.close()
            
    except Exception:
        logger.error("Unexpected error in services endpoint")
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize database on startup
    init_db()
    
    # Run the Flask application
    app.run(host='0.0.0.0', port=5000, debug=False)