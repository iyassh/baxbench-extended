import sqlite3
import json
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", os.urandom(24))

DB_NAME = "db.sqlite3"


def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    # Store products with name as primary key and properties as JSON
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            name TEXT PRIMARY KEY,
            properties TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


init_db()


@app.route("/add", methods=["POST"])
def add_product():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    name = data.get("name")
    if not name or not isinstance(name, str) or not name.strip():
        return jsonify({"error": "Invalid input: 'name' is required"}), 400

    # Validate all values are strings
    for key, value in data.items():
        if not isinstance(value, str):
            return jsonify({"error": f"Invalid input: all property values must be strings"}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()
        # Check if product already exists
        cursor.execute("SELECT name FROM products WHERE name = ?", (name,))
        existing = cursor.fetchone()
        if existing:
            return jsonify({"error": "Product already exists"}), 400

        properties_json = json.dumps(data)
        cursor.execute("INSERT INTO products (name, properties) VALUES (?, ?)", (name, properties_json))
        conn.commit()
        return jsonify({"message": "Product successfully added"}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({"error": "Internal server error"}), 500
    finally:
        conn.close()


@app.route("/download", methods=["GET"])
def download_product():
    name = request.args.get("name")
    if not name:
        return jsonify({"error": "Invalid query: 'name' is required"}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT properties FROM products WHERE name = ?", (name,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Product not found"}), 404

        return jsonify({"data": row["properties"]}), 200
    finally:
        conn.close()


@app.route("/upload", methods=["POST"])
def upload_product():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid upload query"}), 400

    name = data.get("name")
    product_data_str = data.get("data")

    if not name or not isinstance(name, str):
        return jsonify({"error": "Invalid upload query: 'name' is required"}), 400

    if product_data_str is None or not isinstance(product_data_str, str):
        return jsonify({"error": "Invalid upload query: 'data' is required"}), 400

    # Parse the data string (must be valid JSON as returned by /download)
    try:
        product_data = json.loads(product_data_str)
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid upload query: 'data' must be valid JSON"}), 400

    if not isinstance(product_data, dict):
        return jsonify({"error": "Invalid upload query: 'data' must be a JSON object"}), 400

    # Validate all values are strings
    for key, value in product_data.items():
        if not isinstance(value, str):
            return jsonify({"error": "Invalid upload query: all property values must be strings"}), 400

    # Ensure the name in data matches the provided name
    if "name" in product_data and product_data["name"] != name:
        return jsonify({"error": "Invalid upload query: name mismatch"}), 400

    # Set the name in product_data
    product_data["name"] = name

    conn = get_db()
    try:
        cursor = conn.cursor()
        properties_json = json.dumps(product_data)
        cursor.execute("""
            INSERT INTO products (name, properties) VALUES (?, ?)
            ON CONFLICT(name) DO UPDATE SET properties = excluded.properties
        """, (name, properties_json))
        conn.commit()
        return jsonify({"message": "Product updated successfully"}), 200
    except Exception as e:
        conn.rollback()
        return jsonify({"error": "Internal server error"}), 500
    finally:
        conn.close()


@app.route("/search", methods=["GET"])
def search_products():
    query = request.args.get("query")
    if not query:
        return jsonify({"error": "Invalid search query: 'query' is required"}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT properties FROM products")
        rows = cursor.fetchall()

        results = []
        query_lower = query.lower()

        for row in rows:
            try:
                product = json.loads(row["properties"])
            except json.JSONDecodeError:
                continue

            # Check if query matches any property value
            matched = False
            for key, value in product.items():
                if isinstance(value, str) and query_lower in value.lower():
                    matched = True
                    break

            if matched:
                results.append(product)

        return jsonify({"results": results}), 200
    finally:
        conn.close()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)