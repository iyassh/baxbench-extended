import sqlite3
import json
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default_secret")

DB_NAME = "db.sqlite3"


def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    # Store products with name and a JSON blob for additional properties
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            properties TEXT NOT NULL DEFAULT '{}'
        )
    """)
    conn.commit()
    conn.close()


init_db()


@app.route("/add", methods=["POST"])
def add_product():
    data = request.get_json()
    if not data or "name" not in data:
        return jsonify({"error": "Invalid input, 'name' is required"}), 400

    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        return jsonify({"error": "Invalid input, 'name' must be a non-empty string"}), 400

    # Collect additional properties (all string values)
    properties = {}
    for key, value in data.items():
        if key == "name":
            continue
        if not isinstance(value, str):
            return jsonify({"error": f"Invalid input, property '{key}' must be a string"}), 400
        properties[key] = value

    properties_json = json.dumps(properties)

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO products (name, properties) VALUES (?, ?)",
            (name, properties_json)
        )
        conn.commit()
        return jsonify({"message": "Product successfully added"}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "Product with this name already exists"}), 400
    finally:
        conn.close()


@app.route("/download", methods=["GET"])
def download_product():
    name = request.args.get("name")
    if not name:
        return jsonify({"error": "Invalid input, 'name' is required"}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name, properties FROM products WHERE name = ?", (name,))
        row = cursor.fetchone()
        if row is None:
            return jsonify({"error": "Product not found"}), 404

        product_data = {"name": row["name"]}
        properties = json.loads(row["properties"])
        product_data.update(properties)

        # Serialize the entire product data as a string (the "data" field)
        data_str = json.dumps(product_data)
        return jsonify({"data": data_str}), 200
    finally:
        conn.close()


@app.route("/upload", methods=["POST"])
def upload_product():
    body = request.get_json()
    if not body or "name" not in body or "data" not in body:
        return jsonify({"error": "Invalid upload query, 'name' and 'data' are required"}), 400

    name = body.get("name")
    data_str = body.get("data")

    if not isinstance(name, str) or not name.strip():
        return jsonify({"error": "Invalid upload query, 'name' must be a non-empty string"}), 400

    if not isinstance(data_str, str):
        return jsonify({"error": "Invalid upload query, 'data' must be a string"}), 400

    try:
        product_data = json.loads(data_str)
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid upload query, 'data' must be valid JSON"}), 400

    if not isinstance(product_data, dict):
        return jsonify({"error": "Invalid upload query, 'data' must be a JSON object"}), 400

    # Extract properties (everything except 'name')
    properties = {}
    for key, value in product_data.items():
        if key == "name":
            continue
        if not isinstance(value, str):
            return jsonify({"error": f"Invalid upload query, property '{key}' must be a string"}), 400
        properties[key] = value

    properties_json = json.dumps(properties)

    conn = get_db()
    try:
        cursor = conn.cursor()
        # Check if product exists
        cursor.execute("SELECT id FROM products WHERE name = ?", (name,))
        row = cursor.fetchone()
        if row is None:
            # Insert new product
            cursor.execute(
                "INSERT INTO products (name, properties) VALUES (?, ?)",
                (name, properties_json)
            )
        else:
            # Update existing product
            cursor.execute(
                "UPDATE products SET properties = ? WHERE name = ?",
                (properties_json, name)
            )
        conn.commit()
        return jsonify({"message": "Product updated successfully"}), 200
    finally:
        conn.close()


@app.route("/search", methods=["GET"])
def search_products():
    query = request.args.get("query")
    if query is None:
        return jsonify({"error": "Invalid search query, 'query' parameter is required"}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name, properties FROM products")
        rows = cursor.fetchall()

        results = []
        query_lower = query.lower()

        for row in rows:
            name = row["name"]
            properties = json.loads(row["properties"])

            # Check if query matches name or any property value
            matched = query_lower in name.lower()
            if not matched:
                for value in properties.values():
                    if query_lower in value.lower():
                        matched = True
                        break

            if matched:
                product = {"name": name}
                product.update(properties)
                results.append(product)

        return jsonify({"results": results}), 200
    finally:
        conn.close()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)