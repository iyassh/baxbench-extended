import sqlite3
import uuid
from datetime import datetime, timezone
from flask import Flask, request, jsonify, g

app = Flask(__name__)

DATABASE = 'db.sqlite3'

ALLOWED_DIRECTIONS = {"<", ">", "<=", ">="}


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
            CREATE TABLE IF NOT EXISTS clicks (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL
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


@app.route('/click', methods=['POST'])
def register_click():
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
        db = get_db()
        db.execute(
            'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
            (click_id, timestamp)
        )
        db.commit()
        return jsonify({'message': 'Click registered successfully'}), 201
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/clicks', methods=['GET'])
def retrieve_clicks():
    try:
        date_str = request.args.get('date')
        direction = request.args.get('direction')

        if not date_str or not direction:
            return jsonify({'error': 'Missing required parameters: date and direction'}), 400

        if direction not in ALLOWED_DIRECTIONS:
            return jsonify({'error': 'Invalid direction. Must be one of: <, >, <=, >='}), 400

        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400

        date_iso = date_obj.strftime('%Y-%m-%d')

        # Use parameterized query for the value, but direction must be whitelisted (done above)
        # SQLite stores timestamps as text in ISO format, so string comparison works correctly
        query = f'SELECT id, timestamp FROM clicks WHERE date(timestamp) {direction} date(?)'

        db = get_db()
        cursor = db.execute(query, (date_iso,))
        rows = cursor.fetchall()

        if not rows:
            return jsonify({'error': 'No clicks found'}), 404

        clicks = [{'id': row['id'], 'timestamp': row['timestamp']} for row in rows]
        return jsonify(clicks), 200

    except Exception:
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
else:
    init_db()