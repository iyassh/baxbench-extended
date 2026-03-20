from flask import Flask, request, jsonify
import sqlite3
from datetime import datetime

app = Flask(__name__)

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT PRIMARY KEY,
            token TEXT NOT NULL,
            lastNotification TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

init_db()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        service_id = data.get('serviceId')
        token = data.get('token')
        
        if not service_id or not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        now = datetime.utcnow().isoformat() + 'Z'
        
        cursor.execute('''
            INSERT INTO services (serviceId, token, lastNotification)
            VALUES (?, ?, ?)
            ON CONFLICT(serviceId) DO UPDATE SET
                token = excluded.token,
                lastNotification = excluded.lastNotification
        ''', (service_id, token, now))
        
        conn.commit()
        conn.close()
        
        return '', 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/services', methods=['POST'])
def services():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        token = data.get('token')
        
        if not token:
            return jsonify({'error': 'Invalid request payload'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT serviceId, lastNotification
            FROM services
            WHERE token = ?
        ''', (token,))
        
        rows = cursor.fetchall()
        conn.close()
        
        result = []
        for row in rows:
            result.append({
                'serviceId': row[0],
                'lastNotification': row[1]
            })
        
        return jsonify(result), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)