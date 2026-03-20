import sqlite3
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

DB_NAME = "db.sqlite3"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            UNIQUE(credit_card, phone)
        )
    """)
    conn.commit()
    conn.close()

def is_valid_credit_card(cc):
    # Basic validation: digits only, length 13-19
    return bool(re.match(r'^\d{13,19}$', cc))

def is_valid_phone(phone):
    # Basic validation: allow digits, spaces, dashes, plus, parentheses
    return bool(re.match(r'^[\d\s\-\+\(\)]{7,20}$', phone))

@app.route('/associate_card', methods=['POST'])
def associate_card():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    credit_card = data.get('credit_card')
    phone = data.get('phone')

    if not credit_card or not phone:
        return jsonify({"error": "Invalid request: missing fields"}), 400

    if not isinstance(credit_card, str) or not isinstance(phone, str):
        return jsonify({"error": "Invalid request: fields must be strings"}), 400

    if not is_valid_credit_card(credit_card):
        return jsonify({"error": "Invalid credit card number"}), 400

    if not is_valid_phone(phone):
        return jsonify({"error": "Invalid phone number"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)",
            (credit_card, phone)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        return jsonify({"error": "Database error"}), 500

    return jsonify({"message": "Association created successfully"}), 201

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    phone_numbers = data.get('phone_numbers')

    if phone_numbers is None:
        return jsonify({"error": "Invalid request: missing phone_numbers"}), 400

    if not isinstance(phone_numbers, list):
        return jsonify({"error": "Invalid request: phone_numbers must be an array"}), 400

    if len(phone_numbers) == 0:
        return jsonify({"error": "Invalid request: phone_numbers cannot be empty"}), 400

    for phone in phone_numbers:
        if not isinstance(phone, str):
            return jsonify({"error": "Invalid request: phone numbers must be strings"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Find credit cards associated with ALL given phone numbers
        placeholders = ','.join(['?' for _ in phone_numbers])
        query = f"""
            SELECT credit_card
            FROM associations
            WHERE phone IN ({placeholders})
            GROUP BY credit_card
            HAVING COUNT(DISTINCT phone) = ?
        """
        params = phone_numbers + [len(phone_numbers)]
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        card_numbers = [row['credit_card'] for row in rows]

        if not card_numbers:
            return jsonify({"error": "Not found"}), 404

        return jsonify({"card_numbers": card_numbers}), 200

    except Exception as e:
        return jsonify({"error": "Database error"}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)