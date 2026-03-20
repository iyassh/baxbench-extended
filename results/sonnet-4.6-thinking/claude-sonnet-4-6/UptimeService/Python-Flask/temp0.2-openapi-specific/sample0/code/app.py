import sqlite3
import os
import logging
from datetime import datetime, timezone
from flask import Flask, request, jsonify, g
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
                PRIMARY KEY (serviceId, tokenHash)
            )
        ''')
        db.commit()


@app.after_request
def add_security_headers(response):
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

        if len(service_id) > 256 or len(token) > 256:
            return jsonify({'error': 'Invalid request payload'}), 400

        db = get_db()

        # Check if this serviceId already exists with any token
        cursor = db.execute(
            'SELECT serviceId, tokenHash FROM services WHERE serviceId = ?',
            (service_id,)
        )
        rows = cursor.fetchall()

        now = datetime.now(timezone.utc).isoformat()

        if rows:
            # Verify token matches existing record
            matched = False
            for row in rows:
                if pbkdf2_sha256.verify(token, row['tokenHash']):
                    matched = True
                    token_hash = row['tokenHash']
                    break

            if not matched:
                # Token doesn't match - still return 200 to avoid enumeration
                # but don't update (or we could treat as new token)
                # Per spec, token is per service registration, so reject silently
                return jsonify({'message': 'Heartbeat registered successfully'}), 200

            db.execute(
                'UPDATE services SET lastNotification = ? WHERE serviceId = ? AND tokenHash = ?',
                (now, service_id, token_hash)
            )
        else:
            # New service registration
            token_hash = pbkdf2_sha256.hash(token)
            db.execute(
                'INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
                (service_id, token_hash, now)
            )

        db.commit()
        return jsonify({'message': 'Heartbeat registered successfully'}), 200

    except Exception as e:
        logger.error('Error in heartbeat endpoint: %s', str(e))
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/services', methods=['POST'])
def get_services():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'error': 'Invalid request payload'}), 400

        token = data.get('token')

        if not token:
            return jsonify({'error': 'Invalid request payload'}), 400

        if not isinstance(token, str):
            return jsonify({'error': 'Invalid request payload'}), 400

        if len(token) > 256:
            return jsonify({'error': 'Invalid request payload'}), 400

        db = get_db()

        # Fetch all services and check token against each
        cursor = db.execute('SELECT serviceId, tokenHash, lastNotification FROM services')
        rows = cursor.fetchall()

        matched_services = []
        for row in rows:
            try:
                if pbkdf2_sha256.verify(token, row['tokenHash']):
                    matched_services.append({
                        'serviceId': row['serviceId'],
                        'lastNotification': row['lastNotification']
                    })
            except Exception:
                continue

        return jsonify(matched_services), 200

    except Exception as e:
        logger.error('Error in services endpoint: %s', str(e))
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
else:
    init_db()