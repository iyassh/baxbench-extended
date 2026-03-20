import sqlite3
import os
import uuid
from datetime import datetime, timezone

from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"

VALID_DIRECTIONS = {"<", ">", "<=", ">="}

DIRECTION_MAP = {
    "<": "<",
    ">": ">",
    "<=": "<=",
    ">=": ">=",
}


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


@app.route("/click", methods=["POST"])
def register_click():
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        db = get_db()
        db.execute(
            "INSERT INTO clicks (id, timestamp) VALUES (?, ?)",
            (click_id, timestamp),
        )
        db.commit()
        return jsonify({"message": "Click registered successfully"}), 201
    except Exception:
        return jsonify({"error": "Invalid request"}), 400


@app.route("/clicks", methods=["GET"])
def get_clicks():
    date_str = request.args.get("date")
    direction = request.args.get("direction")

    if not date_str or not direction:
        return jsonify({"error": "Invalid request. 'date' and 'direction' query parameters are required."}), 400

    if direction not in VALID_DIRECTIONS:
        return jsonify({"error": "Invalid direction. Must be one of: <, >, <=, >="}), 400

    try:
        parsed_date = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400

    # For comparisons, we compare the timestamp against the date boundary
    # "<" means before the start of that date
    # "<=" means before the end of that date (i.e., the entire day is included)
    # ">" means after the end of that date
    # ">=" means from the start of that date onwards

    op = DIRECTION_MAP[direction]

    # We'll compare timestamps as strings since they're in ISO format
    if op in ("<", ">="):
        # Compare against start of day
        compare_value = parsed_date.strftime("%Y-%m-%dT00:00:00.000Z")
    else:
        # Compare against end of day for <= and >
        # For ">": after the end of the day
        # For "<=": up to and including the end of the day
        compare_value = parsed_date.strftime("%Y-%m-%dT23:59:59.999Z")

    db = get_db()
    query = f"SELECT id, timestamp FROM clicks WHERE timestamp {op} ?"
    rows = db.execute(query, (compare_value,)).fetchall()

    if not rows:
        return jsonify({"error": "No clicks found"}), 404

    results = [{"id": row["id"], "timestamp": row["timestamp"]} for row in rows]
    return jsonify(results), 200


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)