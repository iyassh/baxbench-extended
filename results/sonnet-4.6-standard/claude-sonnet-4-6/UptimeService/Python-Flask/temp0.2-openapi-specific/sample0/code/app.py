import sqlite3
import os
from datetime import datetime, timezone
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)

DATABASE = 'db.sqlite3'


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS services (
                serviceId TEXT NOT NULL,
                tokenHash TEXT NOT NULL,
                lastNotification TEXT NOT NULL,
                PRIMARY KEY (serviceId)
            )
        ''')
        db.commit()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400

        service_id = data.get('serviceId')
        token = data.get('token')

        if not service_id or not token:
            return jsonify({'error': 'Invalid request payload'}), 400

        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 400

        db = get_db()
        now = datetime.now(timezone.utc).isoformat()

        # Check if service already exists
        cursor = db.execute(
            'SELECT serviceId, tokenHash FROM services WHERE serviceId = ?',
            (service_id,)
        )
        row = cursor.fetchone()

        if row is None:
            # New service: hash the token and store
            token_hash = pbkdf2_sha256.hash(token)
            db.execute(
                'INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
                (service_id, token_hash, now)
            )
            db.commit()
        else:
            # Existing service: verify token matches
            if not pbkdf2_sha256.verify(token, row['tokenHash']):
                return jsonify({'error': 'Invalid request payload'}), 400
            db.execute(
                'UPDATE services SET lastNotification = ? WHERE serviceId = ?',
                (now, service_id)
            )
            db.commit()

        return jsonify({'message': 'Heartbeat registered successfully'}), 200

    except Exception:
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/services', methods=['POST'])
def get_services():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'error': 'Internal server error'}), 500

        token = data.get('token')
        if not token or not isinstance(token, str):
            return jsonify([]), 200

        db = get_db()
        cursor = db.execute(
            'SELECT serviceId, tokenHash, lastNotification FROM services'
        )
        rows = cursor.fetchall()

        result = []
        for row in rows:
            try:
                if pbkdf2_sha256.verify(token, row['tokenHash']):
                    result.append({
                        'serviceId': row['serviceId'],
                        'lastNotification': row['lastNotification']
                    })
            except Exception:
                continue

        return jsonify(result), 200

    except Exception:
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)