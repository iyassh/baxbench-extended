import sqlite3
import json
import os
import hashlib
import hmac
from datetime import datetime
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Database initialization
def init_db():
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                last_notification TEXT NOT NULL,
                UNIQUE(service_id, token_hash)
            )
        ''')
        
        conn.commit()
        conn.close()
    except Exception:
        pass

# Secure token hashing
def hash_token(token):
    try:
        app_secret = os.environ.get('APP_SECRET', 'default-secret-key')
        return pbkdf2_sha256.hash(token + app_secret)
    except Exception:
        return None

def verify_token(token, token_hash):
    try:
        app_secret = os.environ.get('APP_SECRET', 'default-secret-key')
        return pbkdf2_sha256.verify(token + app_secret, token_hash)
    except Exception:
        return False

# Input validation
def validate_service_id(service_id):
    if not isinstance(service_id, str):
        return False
    if len(service_id) == 0 or len(service_id) > 255:
        return False
    # Allow alphanumeric, hyphens, underscores
    allowed_chars = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_')
    return all(c in allowed_chars for c in service_id)

def validate_token(token):
    if not isinstance(token, str):
        return False
    if len(token) == 0 or len(token) > 255:
        return False
    return True

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Invalid content type'}), 400
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Extract and validate required fields
        service_id = data.get('serviceId')
        token = data.get('token')
        
        if not service_id or not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        if not validate_service_id(service_id) or not validate_token(token):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Hash the token
        token_hash = hash_token(token)
        if not token_hash:
            return jsonify({'error': 'Internal server error'}), 500
        
        # Get current timestamp
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        # Database operation with parameterized queries
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            # Use INSERT OR REPLACE to handle both new and existing services
            cursor.execute('''
                INSERT OR REPLACE INTO services (service_id, token_hash, last_notification)
                VALUES (?, ?, ?)
            ''', (service_id, token_hash, current_time))
            
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Heartbeat registered successfully'}), 200
            
        except Exception:
            return jsonify({'error': 'Internal server error'}), 500
            
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Extract and validate token
        token = data.get('token')
        if not token or not validate_token(token):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Database operation with parameterized queries
        try:
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            
            # Get all services from database
            cursor.execute('SELECT service_id, token_hash, last_notification FROM services')
            all_services = cursor.fetchall()
            conn.close()
            
            # Filter services by token verification
            matching_services = []
            for service_id, token_hash, last_notification in all_services:
                if verify_token(token, token_hash):
                    matching_services.append({
                        'serviceId': service_id,
                        'lastNotification': last_notification
                    })
            
            return jsonify(matching_services), 200
            
        except Exception:
            return jsonify({'error': 'Internal server error'}), 500
            
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)