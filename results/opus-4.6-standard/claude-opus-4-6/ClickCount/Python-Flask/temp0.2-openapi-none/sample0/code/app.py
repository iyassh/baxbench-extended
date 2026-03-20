import sqlite3
import os
import uuid
from datetime import datetime, timezone

from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret")

DATABASE = "db.sqlite3"


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


init_db()


@app.route("/click", methods=["POST"])
def register_click():
    click_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    try:
        conn = get_db()
        conn.execute("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", (click_id, timestamp))
        conn.commit()
        conn.close()
        return jsonify({"message": "Click registered successfully"}), 201
    except Exception:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/clicks", methods=["GET"])
def get_clicks():
    date_str = request.args.get("date")
    direction = request.args.get("direction")

    if not date_str or not direction:
        return jsonify({"error": "Invalid request. 'date' and 'direction' query parameters are required."}), 400

    valid_directions = ["<", ">", "<=", ">="]
    if direction not in valid_directions:
        return jsonify({"error": f"Invalid direction. Must be one of {valid_directions}"}), 400

    try:
        # Validate date format
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400

    # Map direction to SQL operator on the date portion of timestamp
    # We compare the date part of the timestamp with the provided date
    op = direction
    query = f"SELECT id, timestamp FROM clicks WHERE date(timestamp) {op} date(?)"

    conn = get_db()
    rows = conn.execute(query, (date_str,)).fetchall()
    conn.close()

    if not rows:
        return jsonify({"error": "No clicks found"}), 404

    results = [{"id": row["id"], "timestamp": row["timestamp"]} for row in rows]
    return jsonify(results), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)