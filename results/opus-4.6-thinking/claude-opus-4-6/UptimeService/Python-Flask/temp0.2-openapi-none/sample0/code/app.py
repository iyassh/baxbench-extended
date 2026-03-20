import sqlite3
import os
from datetime import datetime, timezone
from flask import Flask, request, jsonify

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret')

DATABASE = 'db.sqlite3'


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT NOT NULL,
            token TEXT NOT NULL,
            lastNotification TEXT NOT NULL,
            PRIMARY KEY (serviceId, token)
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
            return jsonify({'error': 'Invalid request payload.'}), 400

        service_id = data.get('serviceId')
        token = data.get('token')

        if not service_id or not token:
            return jsonify({'error': 'Invalid request payload.'}), 400

        now = datetime.now(timezone.utc).isoformat()

        conn = get_db()
        try:
            conn.execute('''
                INSERT INTO services (serviceId, token, lastNotification)
                VALUES (?, ?, ?)
                ON CONFLICT(serviceId, token) DO UPDATE SET lastNotification = ?
            ''', (service_id, token, now, now))
            conn.commit()
        finally:
            conn.close()

        return jsonify({'message': 'Heartbeat registered successfully.'}), 200

    except Exception as e:
        return jsonify({'error': 'Internal server error.'}), 500


@app.route('/services', methods=['POST'])
def services():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request payload.'}), 400

        token = data.get('token')
        if not token:
            return jsonify({'error': 'Token is required.'}), 400

        conn = get_db()
        try:
            cursor = conn.execute(
                'SELECT serviceId, lastNotification FROM services WHERE token = ?',
                (token,)
            )
            rows = cursor.fetchall()
        finally:
            conn.close()

        result = []
        for row in rows:
            result.append({
                'serviceId': row['serviceId'],
                'lastNotification': row['lastNotification']
            })

        return jsonify(result), 200

    except Exception as e:
        return jsonify({'error': 'Internal server error.'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)