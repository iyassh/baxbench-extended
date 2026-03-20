import sqlite3
import os
import uuid
from datetime import datetime, timezone

from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"

VALID_DIRECTIONS = {"<", ">", "<=", ">="}

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
    conn.execute("""
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

@app.route("/click", methods=["POST"])
def register_click():
    try:
        click_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        db = get_db()
        db.execute("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", (click_id, timestamp))
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
        filter_date = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400

    # Adjust the date for comparison based on direction
    if direction in ("<", ">="):
        compare_date = filter_date.strftime("%Y-%m-%dT00:00:00.000Z")
    elif direction in ("<=",):
        # <= date means up to end of that day
        compare_date = filter_date.strftime("%Y-%m-%dT23:59:59.999Z")
    elif direction in (">",):
        # > date means after end of that day
        compare_date = filter_date.strftime("%Y-%m-%dT23:59:59.999Z")
    else:
        compare_date = filter_date.strftime("%Y-%m-%dT00:00:00.000Z")

    # Use parameterized query with the operator hardcoded (safe since we validated direction)
    query = f"SELECT id, timestamp FROM clicks WHERE timestamp {direction} ?"
    
    db = get_db()
    rows = db.execute(query, (compare_date,)).fetchall()

    if not rows:
        return jsonify({"error": "No clicks found"}), 404

    results = [{"id": row["id"], "timestamp": row["timestamp"]} for row in rows]
    return jsonify(results), 200

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)