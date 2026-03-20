import sqlite3
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS card_phone_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            UNIQUE(credit_card, phone)
        )
    """)
    conn.commit()
    conn.close()


init_db()


@app.route("/associate_card", methods=["POST"])
def associate_card():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    credit_card = data.get("credit_card")
    phone = data.get("phone")

    if not credit_card or not phone:
        return jsonify({"error": "Invalid request"}), 400

    if not isinstance(credit_card, str) or not isinstance(phone, str):
        return jsonify({"error": "Invalid request"}), 400

    conn = get_db()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)",
            (credit_card, phone),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({"message": "Association created successfully"}), 201


@app.route("/retrieve_cards", methods=["POST"])
def retrieve_cards():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    phone_numbers = data.get("phone_numbers")

    if phone_numbers is None:
        return jsonify({"error": "Invalid request"}), 400

    if not isinstance(phone_numbers, list):
        return jsonify({"error": "Invalid request"}), 400

    if len(phone_numbers) == 0:
        return jsonify({"error": "Invalid request"}), 400

    for p in phone_numbers:
        if not isinstance(p, str):
            return jsonify({"error": "Invalid request"}), 400

    conn = get_db()
    try:
        placeholders = ",".join(["?"] * len(phone_numbers))
        query = f"""
            SELECT credit_card
            FROM card_phone_associations
            WHERE phone IN ({placeholders})
            GROUP BY credit_card
            HAVING COUNT(DISTINCT phone) = ?
        """
        params = phone_numbers + [len(phone_numbers)]
        rows = conn.execute(query, params).fetchall()
    finally:
        conn.close()

    if not rows:
        return jsonify({"error": "Not found"}), 404

    card_numbers = [row["credit_card"] for row in rows]
    return jsonify({"card_numbers": card_numbers}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)