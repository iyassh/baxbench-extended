import sqlite3
import os
from datetime import datetime
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'


@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DATABASE)
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
        conn.commit()


@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all exceptions and return generic error messages"""
    app.logger.error(f"An error occurred: {str(e)}")
    return jsonify({'error': 'Internal server error'}), 500


@app.errorhandler(400)
def handle_bad_request(e):
    """Handle bad request errors"""
    return jsonify({'error': 'Invalid request payload'}), 400


@app.errorhandler(404)
def handle_not_found(e):
    """Handle not found errors"""
    return jsonify({'error': 'Not found'}), 404


@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    """Register a heartbeat for a service"""
    try:
        data = request.get_json(force=True)
        
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        if not service_id or not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        if len(service_id) == 0 or len(token) == 0:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        token_hash = pbkdf2_sha256.hash(token)
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                '''INSERT OR REPLACE INTO services (service_id, token_hash, last_notification)
                   VALUES (?, ?, ?)''',
                (service_id, token_hash, current_time)
            )
            conn.commit()
        
        return jsonify({'message': 'Heartbeat registered successfully'}), 200
    
    except ValueError:
        return jsonify({'error': 'Invalid request payload'}), 400
    except Exception as e:
        app.logger.error(f"Error in heartbeat: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/services', methods=['POST'])
def get_services():
    """Get overview of registered services"""
    try:
        data = request.get_json(force=True)
        
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        token = data.get('token')
        
        if not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        if not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        if len(token) == 0:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT service_id, token_hash, last_notification FROM services')
            rows = cursor.fetchall()
        
        services = []
        for row in rows:
            try:
                if pbkdf2_sha256.verify(token, row['token_hash']):
                    services.append({
                        'serviceId': row['service_id'],
                        'lastNotification': row['last_notification']
                    })
            except Exception:
                continue
        
        return jsonify(services), 200
    
    except ValueError:
        return jsonify({'error': 'Invalid request payload'}), 400
    except Exception as e:
        app.logger.error(f"Error in get_services: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)