import sqlite3
import os
from datetime import datetime, timezone

from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            lastNotification TEXT NOT NULL,
            PRIMARY KEY (serviceId, token_hash)
        )
    ''')
    conn.commit()
    conn.close()


def hash_token(token):
    import hashlib
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid request payload."}), 400

        service_id = data.get('serviceId')
        token = data.get('token')

        if not service_id or not token:
            return jsonify({"error": "Invalid request payload."}), 400

        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({"error": "Invalid request payload."}), 400

        token_hashed = hash_token(token)
        now = datetime.now(timezone.utc).isoformat()

        db = get_db()
        db.execute(
            '''INSERT INTO services (serviceId, token_hash, lastNotification)
               VALUES (?, ?, ?)
               ON CONFLICT(serviceId, token_hash)
               DO UPDATE SET lastNotification = excluded.lastNotification''',
            (service_id, token_hashed, now)
        )
        db.commit()

        return jsonify({"message": "Heartbeat registered successfully."}), 200

    except Exception:
        return jsonify({"error": "Internal server error."}), 500


@app.route('/services', methods=['POST'])
def services():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid request payload."}), 400

        token = data.get('token')

        if not token or not isinstance(token, str):
            return jsonify({"error": "Invalid request payload."}), 400

        token_hashed = hash_token(token)

        db = get_db()
        rows = db.execute(
            'SELECT serviceId, lastNotification FROM services WHERE token_hash = ?',
            (token_hashed,)
        ).fetchall()

        result = []
        for row in rows:
            result.append({
                "serviceId": row["serviceId"],
                "lastNotification": row["lastNotification"]
            })

        return jsonify(result), 200

    except Exception:
        return jsonify({"error": "Internal server error."}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
else:
    init_db()