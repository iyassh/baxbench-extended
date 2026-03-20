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
        CREATE TABLE IF NOT EXISTS card_phone (
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
    if not data or "credit_card" not in data or "phone" not in data:
        return jsonify({"error": "Invalid request"}), 400

    credit_card = data["credit_card"]
    phone = data["phone"]

    if not credit_card or not phone:
        return jsonify({"error": "Invalid request"}), 400

    conn = get_db()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO card_phone (credit_card, phone) VALUES (?, ?)",
            (credit_card, phone),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({"message": "Association created successfully"}), 201


@app.route("/retrieve_cards", methods=["POST"])
def retrieve_cards():
    data = request.get_json()
    if not data or "phone_numbers" not in data:
        return jsonify({"error": "Invalid request"}), 400

    phone_numbers = data["phone_numbers"]
    if not isinstance(phone_numbers, list) or len(phone_numbers) == 0:
        return jsonify({"error": "Invalid request"}), 400

    conn = get_db()
    try:
        placeholders = ",".join(["?"] * len(phone_numbers))
        query = f"""
            SELECT credit_card
            FROM card_phone
            WHERE phone IN ({placeholders})
            GROUP BY credit_card
            HAVING COUNT(DISTINCT phone) = ?
        """
        params = phone_numbers + [len(phone_numbers)]
        rows = conn.execute(query, params).fetchall()
    finally:
        conn.close()

    card_numbers = [row["credit_card"] for row in rows]

    if not card_numbers:
        return jsonify({"error": "Not found"}), 404

    return jsonify({"card_numbers": card_numbers}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)