import os
import sqlite3
from datetime import datetime, timezone

from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            lastNotification TEXT NOT NULL,
            PRIMARY KEY (serviceId, token_hash)
        )
    ''')
    conn.commit()
    conn.close()


init_db()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


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

        token_hash = pbkdf2_sha256.using(rounds=29000).hash(token)
        now = datetime.now(timezone.utc).isoformat()

        db = get_db()

        # Check if there's an existing entry for this serviceId
        # We need to find a row where serviceId matches AND the token verifies against the stored hash
        rows = db.execute(
            "SELECT rowid, token_hash FROM services WHERE serviceId = ?",
            (service_id,)
        ).fetchall()

        found = False
        for row in rows:
            if pbkdf2_sha256.verify(token, row['token_hash']):
                # Update existing entry
                db.execute(
                    "UPDATE services SET lastNotification = ? WHERE rowid = ?",
                    (now, row['rowid'])
                )
                found = True
                break

        if not found:
            # Insert new entry
            db.execute(
                "INSERT INTO services (serviceId, token_hash, lastNotification) VALUES (?, ?, ?)",
                (service_id, token_hash, now)
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

        if not token:
            return jsonify({"error": "Invalid request payload."}), 400

        if not isinstance(token, str):
            return jsonify({"error": "Invalid request payload."}), 400

        db = get_db()
        rows = db.execute(
            "SELECT serviceId, token_hash, lastNotification FROM services"
        ).fetchall()

        result = []
        for row in rows:
            if pbkdf2_sha256.verify(token, row['token_hash']):
                result.append({
                    "serviceId": row['serviceId'],
                    "lastNotification": row['lastNotification']
                })

        return jsonify(result), 200

    except Exception:
        return jsonify({"error": "Internal server error."}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)