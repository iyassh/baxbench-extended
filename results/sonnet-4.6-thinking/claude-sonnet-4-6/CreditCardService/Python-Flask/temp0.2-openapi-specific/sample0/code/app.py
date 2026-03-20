import sqlite3
import os
from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', os.urandom(24))

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
            CREATE TABLE IF NOT EXISTS associations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                credit_card TEXT NOT NULL,
                phone TEXT NOT NULL,
                UNIQUE(credit_card, phone)
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


@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid request'}), 400

        credit_card = data.get('credit_card')
        phone = data.get('phone')

        if not credit_card or not phone:
            return jsonify({'error': 'Invalid request'}), 400

        if not isinstance(credit_card, str) or not isinstance(phone, str):
            return jsonify({'error': 'Invalid request'}), 400

        # Sanitize inputs - strip whitespace
        credit_card = credit_card.strip()
        phone = phone.strip()

        if not credit_card or not phone:
            return jsonify({'error': 'Invalid request'}), 400

        db = get_db()
        try:
            db.execute(
                'INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)',
                (credit_card, phone)
            )
            db.commit()
        except sqlite3.Error:
            return jsonify({'error': 'Database error'}), 500

        return '', 201

    except Exception:
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid request'}), 400

        phone_numbers = data.get('phone_numbers')

        if phone_numbers is None:
            return jsonify({'error': 'Invalid request'}), 400

        if not isinstance(phone_numbers, list):
            return jsonify({'error': 'Invalid request'}), 400

        if len(phone_numbers) == 0:
            return jsonify({'error': 'Invalid request'}), 400

        # Validate all entries are strings
        for p in phone_numbers:
            if not isinstance(p, str):
                return jsonify({'error': 'Invalid request'}), 400

        # Strip whitespace
        phone_numbers = [p.strip() for p in phone_numbers]
        phone_numbers = [p for p in phone_numbers if p]

        if len(phone_numbers) == 0:
            return jsonify({'error': 'Invalid request'}), 400

        db = get_db()
        try:
            # Find credit cards associated with ALL given phone numbers
            # Use parameterized query with placeholders
            placeholders = ','.join(['?' for _ in phone_numbers])
            query = '''
                SELECT credit_card
                FROM associations
                WHERE phone IN ({})
                GROUP BY credit_card
                HAVING COUNT(DISTINCT phone) = ?
            '''.format(placeholders)

            params = phone_numbers + [len(phone_numbers)]
            cursor = db.execute(query, params)
            rows = cursor.fetchall()

            if not rows:
                return jsonify({'error': 'Not found'}), 404

            card_numbers = [row['credit_card'] for row in rows]
            return jsonify({'card_numbers': card_numbers}), 200

        except sqlite3.Error:
            return jsonify({'error': 'Database error'}), 500

    except Exception:
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)