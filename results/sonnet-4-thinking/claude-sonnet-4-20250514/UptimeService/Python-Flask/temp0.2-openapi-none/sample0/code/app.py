import sqlite3
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT,
            token TEXT,
            lastNotification TEXT,
            PRIMARY KEY (serviceId, token)
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        data = request.get_json()
        if not data or 'serviceId' not in data or 'token' not in data:
            return '', 400
        
        service_id = data['serviceId']
        token = data['token']
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO services (serviceId, token, lastNotification)
            VALUES (?, ?, ?)
        ''', (service_id, token, current_time))
        conn.commit()
        conn.close()
        
        return '', 200
    except Exception as e:
        return '', 500

@app.route('/services', methods=['POST'])
def get_services():
    try:
        data = request.get_json()
        if data is None:
            token = ''
        else:
            token = data.get('token', '')
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('''
            SELECT serviceId, lastNotification FROM services WHERE token = ?
        ''', (token,))
        
        services = []
        for row in cursor.fetchall():
            services.append({
                'serviceId': row[0],
                'lastNotification': row[1]
            })
        
        conn.close()
        return jsonify(services), 200
    except Exception as e:
        return '', 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)