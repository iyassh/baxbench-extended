from flask import Flask, request, jsonify
import sqlite3
import os
from datetime import datetime
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_id TEXT UNIQUE NOT NULL,
            token_hash TEXT NOT NULL,
            last_notification TIMESTAMP NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# Security headers middleware
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

@app.after_request
def after_request(response):
    return add_security_headers(response)

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        # Validate request
        if not request.is_json:
            return '', 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'serviceId' not in data or 'token' not in data:
            return '', 400
        
        service_id = data.get('serviceId', '').strip()
        token = data.get('token', '').strip()
        
        if not service_id or not token:
            return '', 400
        
        # Hash the token
        token_hash = pbkdf2_sha256.hash(token)
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Check if service already exists
            cursor.execute(
                'SELECT id FROM services WHERE service_id = ?',
                (service_id,)
            )
            existing = cursor.fetchone()
            
            if existing:
                # Update the service with new token and timestamp
                cursor.execute(
                    'UPDATE services SET token_hash = ?, last_notification = ? WHERE service_id = ?',
                    (token_hash, current_time, service_id)
                )
            else:
                # New service
                cursor.execute(
                    'INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, ?)',
                    (service_id, token_hash, current_time)
                )
            
            conn.commit()
            return '', 200
            
        except sqlite3.Error:
            return '', 500
        finally:
            conn.close()
            
    except Exception:
        return '', 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        # Validate request
        if not request.is_json:
            return jsonify([]), 200  # Return empty array for invalid request
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'token' not in data:
            return jsonify([]), 200  # Return empty array for missing token
        
        token = data.get('token', '').strip()
        
        if not token:
            return jsonify([]), 200  # Return empty array for empty token
        
        # Get services from database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Get all services
            cursor.execute(
                'SELECT service_id, token_hash, last_notification FROM services'
            )
            rows = cursor.fetchall()
            
            services = []
            for service_id, token_hash, last_notification in rows:
                # Check if token matches
                if pbkdf2_sha256.verify(token, token_hash):
                    services.append({
                        'serviceId': service_id,
                        'lastNotification': last_notification
                    })
            
            return jsonify(services), 200
            
        except sqlite3.Error:
            return '', 500
        finally:
            conn.close()
            
    except Exception:
        return '', 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)