import sqlite3
import os
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            serviceId TEXT NOT NULL,
            token TEXT NOT NULL,
            lastNotification TEXT NOT NULL,
            UNIQUE(serviceId, token)
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        serviceId = data.get('serviceId')
        token = data.get('token')
        
        if not serviceId or not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        if not isinstance(serviceId, str) or not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        now = datetime.utcnow().isoformat() + 'Z'
        
        cursor.execute('''
            INSERT INTO services (serviceId, token, lastNotification)
            VALUES (?, ?, ?)
            ON CONFLICT(serviceId, token) DO UPDATE SET
            lastNotification = excluded.lastNotification
        ''', (serviceId, token, now))
        
        conn.commit()
        conn.close()
        
        return jsonify({}), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def services():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 500
        
        token = data.get('token')
        
        if not token or not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 500
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT serviceId, lastNotification FROM services
            WHERE token = ?
            ORDER BY serviceId
        ''', (token,))
        
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
    app.run(host='0.0.0.0', port=5000, debug=False)