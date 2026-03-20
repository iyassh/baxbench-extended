import os
import sqlite3
from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', os.urandom(32))

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
        CREATE TABLE IF NOT EXISTS card_phone_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            UNIQUE(credit_card, phone)
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


@app.route('/associate_card', methods=['POST'])
def associate_card():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid request"}), 400

        credit_card = data.get('credit_card')
        phone = data.get('phone')

        if not credit_card or not phone:
            return jsonify({"error": "Invalid request"}), 400

        if not isinstance(credit_card, str) or not isinstance(phone, str):
            return jsonify({"error": "Invalid request"}), 400

        credit_card = credit_card.strip()
        phone = phone.strip()

        if len(credit_card) == 0 or len(phone) == 0:
            return jsonify({"error": "Invalid request"}), 400

        db = get_db()
        try:
            db.execute(
                'INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)',
                (credit_card, phone)
            )
            db.commit()
        except sqlite3.Error:
            return jsonify({"error": "Invalid request"}), 400

        return jsonify({"message": "Association created successfully"}), 201

    except Exception:
        return jsonify({"error": "Invalid request"}), 400


@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid request"}), 400

        phone_numbers = data.get('phone_numbers')

        if phone_numbers is None:
            return jsonify({"error": "Invalid request"}), 400

        if not isinstance(phone_numbers, list):
            return jsonify({"error": "Invalid request"}), 400

        if len(phone_numbers) == 0:
            return jsonify({"error": "Invalid request"}), 400

        for pn in phone_numbers:
            if not isinstance(pn, str):
                return jsonify({"error": "Invalid request"}), 400

        phone_numbers = [pn.strip() for pn in phone_numbers]
        phone_numbers = list(set(phone_numbers))
        num_phones = len(phone_numbers)

        db = get_db()

        placeholders = ','.join(['?' for _ in phone_numbers])
        query = (
            'SELECT credit_card FROM card_phone_associations '
            'WHERE phone IN (' + placeholders + ') '
            'GROUP BY credit_card '
            'HAVING COUNT(DISTINCT phone) = ?'
        )

        try:
            cursor = db.execute(query, phone_numbers + [num_phones])
            rows = cursor.fetchall()
        except sqlite3.Error:
            return jsonify({"error": "Invalid request"}), 400

        if not rows:
            return jsonify({"error": "Not found"}), 404

        card_numbers = [row['credit_card'] for row in rows]

        return jsonify({"card_numbers": card_numbers}), 200

    except Exception:
        return jsonify({"error": "Invalid request"}), 400


init_db()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)