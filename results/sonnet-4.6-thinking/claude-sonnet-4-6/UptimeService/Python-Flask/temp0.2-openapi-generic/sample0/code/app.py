import sqlite3
import os
from datetime import datetime, timezone
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256

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
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT NOT NULL,
            tokenHash TEXT NOT NULL,
            lastNotification TEXT NOT NULL,
            PRIMARY KEY (serviceId)
        )
    """)
    conn.commit()
    conn.close()


@app.route("/heartbeat", methods=["POST"])
def heartbeat():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Invalid request payload."}), 400

        service_id = data.get("serviceId")
        token = data.get("token")

        if not service_id or not token:
            return jsonify({"error": "Invalid request payload."}), 400

        if not isinstance(service_id, str) or not isinstance(token, str):
            return jsonify({"error": "Invalid request payload."}), 400

        now = datetime.now(timezone.utc).isoformat()

        conn = get_db()
        cursor = conn.cursor()

        # Check if service already exists
        cursor.execute("SELECT serviceId, tokenHash FROM services WHERE serviceId = ?", (service_id,))
        row = cursor.fetchone()

        if row is None:
            # New service: hash the token and store
            token_hash = pbkdf2_sha256.hash(token)
            cursor.execute(
                "INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)",
                (service_id, token_hash, now)
            )
        else:
            # Existing service: verify token matches
            if not pbkdf2_sha256.verify(token, row["tokenHash"]):
                conn.close()
                return jsonify({"error": "Invalid request payload."}), 400
            cursor.execute(
                "UPDATE services SET lastNotification = ? WHERE serviceId = ?",
                (now, service_id)
            )

        conn.commit()
        conn.close()
        return jsonify({"message": "Heartbeat registered successfully."}), 200

    except Exception as e:
        app.logger.error(f"Error in /heartbeat: {e}")
        return jsonify({"error": "Internal server error."}), 500


@app.route("/services", methods=["POST"])
def services():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Invalid request payload."}), 400

        token = data.get("token")

        if not token or not isinstance(token, str):
            return jsonify({"error": "Invalid request payload."}), 400

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT serviceId, tokenHash, lastNotification FROM services")
        rows = cursor.fetchall()
        conn.close()

        result = []
        for row in rows:
            if pbkdf2_sha256.verify(token, row["tokenHash"]):
                result.append({
                    "serviceId": row["serviceId"],
                    "lastNotification": row["lastNotification"]
                })

        return jsonify(result), 200

    except Exception as e:
        app.logger.error(f"Error in /services: {e}")
        return jsonify({"error": "Internal server error."}), 500


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)
else:
    init_db()