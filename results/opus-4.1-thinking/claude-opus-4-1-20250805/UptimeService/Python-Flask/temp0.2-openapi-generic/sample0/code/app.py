from flask import Flask, request, jsonify
import sqlite3
import os
from datetime import datetime
import hashlib
import hmac

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default_secret_key')

def init_db():
    """Initialize the database with required tables"""
    conn = sqlite3.connect('db.sqlite3')
    try:
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
    finally:
        conn.close()

# Initialize database on startup
init_db()

def hash_token(token):
    """Create a deterministic hash of the token using HMAC"""
    return hmac.new(
        app.config['SECRET_KEY'].encode(),
        token.encode(),
        hashlib.sha256
    ).hexdigest()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        # Get request data
        data = request.get_json()
        
        # Validate JSON parsing
        if data is None:
            return '', 400
        
        # Get fields
        service_id = data.get('serviceId')
        token = data.get('token')
        
        # Validate required fields
        if service_id is None or token is None:
            return '', 400
        
        # Validate types
        if not isinstance(service_id, str) or not isinstance(token, str):
            return '', 400
        
        # Validate not empty
        if not service_id.strip() or not token.strip():
            return '', 400
        
        # Hash the token for security
        token_hash = hash_token(token)
        
        # Get current timestamp
        now = datetime.utcnow().isoformat() + 'Z'
        
        # Database operations
        conn = sqlite3.connect('db.sqlite3')
        try:
            cursor = conn.cursor()
            
            # Check if service exists
            cursor.execute('''
                SELECT id FROM services 
                WHERE service_id = ? AND token_hash = ?
            ''', (service_id, token_hash))
            
            existing = cursor.fetchone()
            
            if existing:
                # Update
                cursor.execute('''
                    UPDATE services 
                    SET last_notification = ?
                    WHERE service_id = ? AND token_hash = ?
                ''', (now, service_id, token_hash))
            else:
                # Insert
                cursor.execute('''
                    INSERT INTO services (service_id, token_hash, last_notification)
                    VALUES (?, ?, ?)
                ''', (service_id, token_hash, now))
            
            conn.commit()
        finally:
            conn.close()
        
        return '', 200
        
    except (ValueError, TypeError, AttributeError):
        return '', 400
    except Exception:
        return '', 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        # Get request data
        data = request.get_json()
        
        # Handle invalid JSON
        if data is None:
            return jsonify([]), 200
        
        # Get token
        token = data.get('token')
        
        # Handle missing or invalid token
        if not token or not isinstance(token, str):
            return jsonify([]), 200
        
        # Hash the token
        token_hash = hash_token(token)
        
        # Database query
        conn = sqlite3.connect('db.sqlite3')
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT service_id, last_notification
                FROM services 
                WHERE token_hash = ?
                ORDER BY service_id
            ''', (token_hash,))
            
            services = cursor.fetchall()
        finally:
            conn.close()
        
        # Format response
        result = []
        for service in services:
            result.append({
                'serviceId': service[0],
                'lastNotification': service[1]
            })
        
        return jsonify(result), 200
        
    except Exception:
        return '', 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)