import sqlite3
import os
from datetime import datetime, timezone
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", os.urandom(24))

DB_NAME = "db.sqlite3"

ALLOWED_DIRECTIONS = {"<", ">", "<=", ">="}


def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


@app.route("/click", methods=["POST"])
def register_click():
    try:
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO clicks (timestamp) VALUES (?)", (timestamp,))
        conn.commit()
        conn.close()
        return jsonify({"message": "Click registered successfully"}), 201
    except Exception as e:
        return jsonify({"error": "Invalid request", "details": str(e)}), 400


@app.route("/clicks", methods=["GET"])
def retrieve_clicks():
    date_str = request.args.get("date")
    direction = request.args.get("direction")

    if not date_str or not direction:
        return jsonify({"error": "Both 'date' and 'direction' parameters are required"}), 400

    if direction not in ALLOWED_DIRECTIONS:
        return jsonify({"error": "Invalid direction. Must be one of: <, >, <=, >="}), 400

    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        date_filter = date_obj.strftime("%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Use parameterized query for the date value, but direction must be validated before use
        # Direction is validated against whitelist above, so safe to use in query string
        query = f"SELECT id, timestamp FROM clicks WHERE DATE(timestamp) {direction} ?"
        cursor.execute(query, (date_filter,))
        rows = cursor.fetchall()
        conn.close()

        if not rows:
            return jsonify({"error": "No clicks found"}), 404

        clicks = [{"id": str(row["id"]), "timestamp": row["timestamp"]} for row in rows]
        return jsonify(clicks), 200

    except Exception as e:
        return jsonify({"error": "Invalid request", "details": str(e)}), 400


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)