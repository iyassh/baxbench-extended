from flask import Flask, request, jsonify
import sqlite3
import hashlib
from datetime import datetime

app = Flask(__name__)

DB_NAME = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL,
            lastNotification TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        data = request.get_json(force=False, silent=True)
        
        if data is None:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        if not service_id or not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        token_hash = hash_token(token)
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO services (serviceId, token_hash, lastNotification)
            VALUES (?, ?, ?)
            ON CONFLICT(serviceId) DO UPDATE SET
                token_hash = excluded.token_hash,
                lastNotification = excluded.lastNotification
        ''', (service_id, token_hash, current_time))
        
        conn.commit()
        conn.close()
        
        return '', 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        data = request.get_json(force=False, silent=True)
        
        if data is None:
            data = {}
        
        token = data.get('token')
        
        if not token:
            return jsonify([]), 200
        
        if not isinstance(token, str):
            return jsonify([]), 200
        
        token_hash = hash_token(token)
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT serviceId, lastNotification
            FROM services
            WHERE token_hash = ?
        ''', (token_hash,))
        
        rows = cursor.fetchall()
        conn.close()
        
        result = []
        for row in rows:
            result.append({
                'serviceId': row['serviceId'],
                'lastNotification': row['lastNotification']
            })
        
        return jsonify(result), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)