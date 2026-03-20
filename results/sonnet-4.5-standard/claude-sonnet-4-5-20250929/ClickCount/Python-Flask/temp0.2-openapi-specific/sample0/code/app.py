from flask import Flask, request, jsonify
import sqlite3
import os
from datetime import datetime
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

@contextmanager
def get_db_connection():
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
    """Initialize the database with the clicks table"""
    with get_db_connection() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS clicks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL
            )
        ''')

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/click', methods=['POST'])
def register_click():
    """Register a click in the database"""
    try:
        timestamp = datetime.utcnow().isoformat()
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO clicks (timestamp) VALUES (?)',
                (timestamp,)
            )
        
        return jsonify({'message': 'Click registered successfully'}), 201
    
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    """Retrieve clicks based on date and direction filters"""
    try:
        date_param = request.args.get('date')
        direction = request.args.get('direction')
        
        if not date_param or not direction:
            return jsonify({'error': 'Invalid request'}), 400
        
        if direction not in ['<', '>', '<=', '>=']:
            return jsonify({'error': 'Invalid request'}), 400
        
        try:
            datetime.strptime(date_param, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Invalid request'}), 400
        
        query = f'SELECT id, timestamp FROM clicks WHERE timestamp {direction} ?'
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (date_param,))
            rows = cursor.fetchall()
        
        if not rows:
            return jsonify({'error': 'No clicks found'}), 404
        
        clicks = []
        for row in rows:
            clicks.append({
                'id': str(row['id']),
                'timestamp': row['timestamp']
            })
        
        return jsonify(clicks), 200
    
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)