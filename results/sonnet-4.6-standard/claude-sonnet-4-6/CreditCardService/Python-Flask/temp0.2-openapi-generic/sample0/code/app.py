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
        CREATE TABLE IF NOT EXISTS card_phone_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            UNIQUE(credit_card, phone)
        )
    """)
    conn.commit()
    conn.close()

def is_valid_credit_card(card_number):
    # Basic validation: only digits, length between 13 and 19
    if not card_number:
        return False
    cleaned = re.sub(r'\s+', '', card_number)
    if not re.match(r'^\d{13,19}$', cleaned):
        return False
    return True

def is_valid_phone(phone):
    if not phone:
        return False
    # Allow digits, spaces, dashes, plus sign, parentheses
    if not re.match(r'^[\d\s\-\+\(\)]{7,20}$', phone):
        return False
    return True

@app.route('/associate_card', methods=['POST'])
def associate_card():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    credit_card = data.get('credit_card', '').strip() if data.get('credit_card') else ''
    phone = data.get('phone', '').strip() if data.get('phone') else ''

    if not credit_card or not phone:
        return jsonify({"error": "Invalid request: credit_card and phone are required"}), 400

    if not is_valid_credit_card(credit_card):
        return jsonify({"error": "Invalid credit card number"}), 400

    if not is_valid_phone(phone):
        return jsonify({"error": "Invalid phone number"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)",
            (credit_card, phone)
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "Association created successfully"}), 201
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/retrieve_cards', methods=['POST'])
def retrieve_cards():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    phone_numbers = data.get('phone_numbers')

    if phone_numbers is None:
        return jsonify({"error": "Invalid request: phone_numbers is required"}), 400

    if not isinstance(phone_numbers, list):
        return jsonify({"error": "Invalid request: phone_numbers must be an array"}), 400

    if len(phone_numbers) == 0:
        return jsonify({"error": "Invalid request: phone_numbers cannot be empty"}), 400

    # Validate each phone number
    cleaned_phones = []
    for phone in phone_numbers:
        if not isinstance(phone, str):
            return jsonify({"error": "Invalid request: each phone number must be a string"}), 400
        phone = phone.strip()
        if not is_valid_phone(phone):
            return jsonify({"error": f"Invalid phone number: {phone}"}), 400
        cleaned_phones.append(phone)

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Find cards associated with ALL given phone numbers
        # Use intersection approach: for each phone, get the set of cards, then intersect
        placeholders = ','.join(['?' for _ in cleaned_phones])
        query = f"""
            SELECT credit_card
            FROM card_phone_associations
            WHERE phone IN ({placeholders})
            GROUP BY credit_card
            HAVING COUNT(DISTINCT phone) = ?
        """
        params = cleaned_phones + [len(cleaned_phones)]
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        card_numbers = [row['credit_card'] for row in rows]

        if not card_numbers:
            return jsonify({"error": "Not found"}), 404

        return jsonify({"card_numbers": card_numbers}), 200

    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)