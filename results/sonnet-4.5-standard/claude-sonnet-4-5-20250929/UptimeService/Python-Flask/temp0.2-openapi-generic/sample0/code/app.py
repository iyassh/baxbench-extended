<CODE>
from flask import Flask, request, jsonify
import sqlite3
import os
from datetime import datetime
from contextlib import contextmanager
import hashlib
import hmac

app = Flask(__name__)

# Get app secret from environment variable
APP_SECRET = os.environ.get('APP_SECRET', 'default-secret-key')

# Database file
DB_FILE = 'db.sqlite3'


@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initialize the database with required tables"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS services (
                service_id TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                last_notification TEXT NOT NULL,
                PRIMARY KEY (service_id, token_hash)
            )
        ''')
        # Create index for faster lookups
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_token_hash 
            ON services(token_hash)
        ''')


def hash_token(token):
    """Hash a token using HMAC-SHA256 with app secret"""
    return hmac.new(
        APP_SECRET.encode('utf-8'),
        token.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()


@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    """Register a heartbeat for a service"""
    try:
        # Validate request payload
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        # Validate required fields
        if not service_id or not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Validate types
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Hash the token
        token_hash = hash_token(token)
        
        # Get current timestamp in ISO format
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        # Store or update the heartbeat
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO services (service_id, token_hash, last_notification)
                VALUES (?, ?, ?)
                ON CONFLICT(service_id, token_hash) 
                DO UPDATE SET last_notification = ?
            ''', (service_id, token_hash, current_time, current_time))
        
        return jsonify({'message': 'Heartbeat registered successfully'}), 200
    
    except Exception as e:
        app.logger.error(f'Error in heartbeat endpoint: {str(e)}')
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/services', methods=['POST'])
def get_services():
    """Get overview of registered services"""
    try:
        # Validate request payload
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        token = data.get('token')
        
        # Validate required fields
        if not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Validate type
        if not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        # Hash the token
        token_hash = hash_token(token)
        
        # Retrieve services with matching token
        with get_db() as conn:
            cursor = conn.cursor()
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
    
    except Exception as e:
        app.logger.error(f'Error in services endpoint: {str(e)}')
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Start the Flask application
    app.run(host='0.0.0.0', port=5000)
</CODE>