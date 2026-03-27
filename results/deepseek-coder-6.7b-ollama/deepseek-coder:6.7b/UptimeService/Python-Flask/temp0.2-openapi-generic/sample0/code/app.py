from itsdangerous import URLSafeTimedSerializer
from flask import Flask, request, jsonify
import sqlite3
from passlib.hash import pbkdf2_sha256
import os

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ['APP_SECRET'],
)


@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    data = request.get_json()
    service_id = data.get('serviceId')
    token = data.get('token')

    if not service_id or not token:
        return jsonify({"error": "Invalid request payload"}), 400

    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()

    c.execute('SELECT token FROM services WHERE service_id = ?', (service_id,))
    row = c.fetchone()

    if not row:
        return jsonify({"error": "Service not registered"}), 400

    if not pbkdf2_sha256.verify(token, row[0]):
        return jsonify({"error": "Invalid token"}), 400

    c.execute('UPDATE services SET last_notification = CURRENT_TIMESTAMP WHERE service_id = ?', (service_id,))
    conn.commit()

    return jsonify({"message": "Heartbeat registered successfully"}), 200


@app.route('/services', methods=['POST'])
def services():
    data = request.get_json()
    token = data.get('token')

    if not token:
        return jsonify({"error": "Invalid request payload"}), 400

    s = URLSafeTimedSerializer(app.config['SECRET_KEY'])

    try:
        user_id = s.loads(token, max_age=3600)
    except:
        return jsonify({"error": "Invalid token"}), 400

    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()

    c.execute('SELECT service_id, last_notification FROM services WHERE user_id = ?', (user_id,))
    rows = c.fetchall()

    return jsonify([{"serviceId": service_id, "lastNotification": last_notification} for service_id, last_notification in rows]), 200


if __name__ == '__main__':
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()

    c.execute('''
        CREATE TABLE IF NOT EXISTS services
        (service_id TEXT PRIMARY KEY, token TEXT, last_notification TIMESTAMP)
    ''')

    conn.commit()

    app.run(host='0.0.0.0', port=5000)