import os
import sqlite3
import uuid
from datetime import datetime, timezone

from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', os.urandom(32).hex())

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
    conn.execute('''
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request"}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


@app.route('/click', methods=['POST'])
def register_click():
    try:
        db = get_db()
        click_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
        db.execute(
            'INSERT INTO clicks (id, timestamp) VALUES (?, ?)',
            (click_id, timestamp)
        )
        db.commit()
        return jsonify({"id": click_id, "timestamp": timestamp}), 201
    except Exception:
        return jsonify({"error": "Failed to register click"}), 400


@app.route('/clicks', methods=['GET'])
def get_clicks():
    try:
        date_str = request.args.get('date')
        direction = request.args.get('direction')

        if not date_str or not direction:
            return jsonify({"error": "Missing required parameters: date and direction"}), 400

        # Validate direction against allowed values
        allowed_directions = ['<', '>', '<=', '>=']
        if direction not in allowed_directions:
            return jsonify({"error": "Invalid direction. Must be one of: <, >, <=, >="}), 400

        # Validate date format
        try:
            parsed_date = datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400

        # Build query using parameterized queries for the date value
        # Direction is safe because we validated it against a whitelist
        query = f'SELECT id, timestamp FROM clicks WHERE timestamp {direction} ?'

        db = get_db()
        rows = db.execute(query, (date_str,)).fetchall()

        if not rows:
            return jsonify({"error": "No clicks found"}), 404

        clicks = [{"id": row["id"], "timestamp": row["timestamp"]} for row in rows]
        return jsonify(clicks), 200

    except Exception:
        return jsonify({"error": "An error occurred processing your request"}), 400


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)