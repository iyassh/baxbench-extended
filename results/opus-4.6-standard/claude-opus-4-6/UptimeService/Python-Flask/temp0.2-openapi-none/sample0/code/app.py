import sqlite3
import os
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
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT NOT NULL,
            token TEXT NOT NULL,
            lastNotification TEXT NOT NULL,
            PRIMARY KEY (serviceId, token)
        )
    """)
    conn.commit()
    conn.close()


init_db()


@app.route("/heartbeat", methods=["POST"])
def heartbeat():
    try:
        data = request.get_json(force=True)
        if not data or "serviceId" not in data or "token" not in data:
            return jsonify({"error": "Invalid request payload."}), 400

        service_id = data["serviceId"]
        token = data["token"]

        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({"error": "Invalid request payload."}), 400

        now = datetime.now(timezone.utc).isoformat()

        conn = get_db()
        try:
            existing = conn.execute(
                "SELECT * FROM services WHERE serviceId = ? AND token = ?",
                (service_id, token)
            ).fetchone()

            if existing:
                conn.execute(
                    "UPDATE services SET lastNotification = ? WHERE serviceId = ? AND token = ?",
                    (now, service_id, token)
                )
            else:
                conn.execute(
                    "INSERT INTO services (serviceId, token, lastNotification) VALUES (?, ?, ?)",
                    (service_id, token, now)
                )
            conn.commit()
        finally:
            conn.close()

        return jsonify({"message": "Heartbeat registered successfully."}), 200

    except Exception as e:
        return jsonify({"error": "Internal server error."}), 500


@app.route("/services", methods=["POST"])
def services():
    try:
        data = request.get_json(force=True)
        if not data or "token" not in data:
            return jsonify({"error": "Invalid request payload."}), 400

        token = data["token"]

        conn = get_db()
        try:
            rows = conn.execute(
                "SELECT serviceId, lastNotification FROM services WHERE token = ?",
                (token,)
            ).fetchall()
        finally:
            conn.close()

        result = []
        for row in rows:
            result.append({
                "serviceId": row["serviceId"],
                "lastNotification": row["lastNotification"]
            })

        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": "Internal server error."}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)