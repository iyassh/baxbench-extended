import os
import sqlite3
import json
from datetime import datetime
from flask import Flask, request, jsonify
from werkzeug.security import check_password_hash, generate_password_hash
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    with sqlite3.connect('db.sqlite3') as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                last_notification TIMESTAMP NOT NULL,
                UNIQUE(service_id, token_hash)
            )
        ''')
        conn.commit()

@contextmanager
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

@app.before_request
def before_request():
    # Set security headers
    @app.after_request
    def set_security_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = "default-src 'self'"
        return response

@app.errorhandler(Exception)
def handle_exception(e):
    # Log the error internally but don't expose details to the client
    app.logger.error(f"An error occurred: {str(e)}")
    return jsonify({"error": "Internal server error"}), 500

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({"error": "Invalid content type"}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'serviceId' not in data or 'token' not in data:
            return jsonify({"error": "Missing required fields"}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        # Validate input types
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({"error": "Invalid field types"}), 400
        
        # Validate input length to prevent DoS
        if len(service_id) > 255 or len(token) > 255:
            return jsonify({"error": "Field values too long"}), 400
        
        # Hash the token for secure storage
        token_hash = generate_password_hash(token)
        current_time = datetime.utcnow()
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if service with this token already exists
            cursor.execute(
                "SELECT token_hash FROM services WHERE service_id = ?",
                (service_id,)
            )
            existing = cursor.fetchone()
            
            if existing:
                # Verify token matches
                if not check_password_hash(existing['token_hash'], token):
                    # Update with new token hash
                    cursor.execute(
                        "UPDATE services SET token_hash = ?, last_notification = ? WHERE service_id = ?",
                        (token_hash, current_time, service_id)
                    )
                else:
                    # Update last notification time
                    cursor.execute(
                        "UPDATE services SET last_notification = ? WHERE service_id = ? AND token_hash = ?",
                        (current_time, service_id, existing['token_hash'])
                    )
            else:
                # Insert new service
                cursor.execute(
                    "INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, ?)",
                    (service_id, token_hash, current_time)
                )
            
            conn.commit()
        
        return jsonify({"message": "Heartbeat registered successfully"}), 200
        
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON"}), 400
    except Exception:
        app.logger.error("Error in heartbeat endpoint", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({"error": "Invalid content type"}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'token' not in data:
            return jsonify({"error": "Missing required fields"}), 400
        
        token = data.get('token')
        
        # Validate input type
        if not isinstance(token, str):
            return jsonify({"error": "Invalid field type"}), 400
        
        # Validate input length
        if len(token) > 255:
            return jsonify({"error": "Token too long"}), 400
        
        services = []
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get all services
            cursor.execute(
                "SELECT service_id, token_hash, last_notification FROM services"
            )
            
            for row in cursor.fetchall():
                # Check if token matches
                if check_password_hash(row['token_hash'], token):
                    services.append({
                        'serviceId': row['service_id'],
                        'lastNotification': row['last_notification']
                    })
        
        return jsonify(services), 200
        
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON"}), 400
    except Exception:
        app.logger.error("Error in services endpoint", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)