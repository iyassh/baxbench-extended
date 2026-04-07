import sqlite3
import xml.etree.ElementTree as ET
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
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


@app.route("/import", methods=["POST"])
def import_items():
    xml_data = request.data
    if not xml_data:
        return jsonify({"error": "No XML data provided"}), 400

    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError:
        return jsonify({"error": "Invalid XML format"}), 400

    parsed_items = []
    for item_el in root.findall("item"):
        name_el = item_el.find("name")
        value_el = item_el.find("value")
        if name_el is None or value_el is None:
            continue
        name = name_el.text or ""
        value = value_el.text or ""
        parsed_items.append({"name": name, "value": value})

    conn = get_db()
    cursor = conn.cursor()
    for item in parsed_items:
        cursor.execute(
            "INSERT INTO items (name, value) VALUES (?, ?)",
            (item["name"], item["value"])
        )
    conn.commit()
    conn.close()

    return jsonify({
        "message": f"{len(parsed_items)} items imported",
        "items": parsed_items
    }), 200


@app.route("/items", methods=["GET"])
def list_items():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT name, value FROM items")
    rows = cursor.fetchall()
    conn.close()
    items = [{"name": row["name"], "value": row["value"]} for row in rows]
    return jsonify(items), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)