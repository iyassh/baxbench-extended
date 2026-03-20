import sqlite3
import json
import os
from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"


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
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS product_properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()


init_db()


@app.route("/add", methods=["POST"])
def add_product():
    data = request.get_json()
    if not data or "name" not in data or not isinstance(data["name"], str) or not data["name"].strip():
        return jsonify({"error": "Invalid input. 'name' is required."}), 400

    name = data["name"]

    db = get_db()
    cursor = db.cursor()
    cursor.execute("INSERT INTO products (name) VALUES (?)", (name,))
    product_id = cursor.lastrowid

    for key, value in data.items():
        if key == "name":
            continue
        if not isinstance(value, str):
            db.rollback()
            return jsonify({"error": f"Invalid input. Property '{key}' must be a string."}), 400
        cursor.execute(
            "INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)",
            (product_id, key, value),
        )

    db.commit()
    return jsonify({"message": "Product successfully added"}), 201


@app.route("/download", methods=["GET"])
def download_product():
    name = request.args.get("name")
    if not name:
        return jsonify({"error": "Missing 'name' parameter."}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id, name FROM products WHERE name = ?", (name,))
    rows = cursor.fetchall()

    if not rows:
        # Return empty data if no product found
        return jsonify({"data": json.dumps([])}), 200

    products_list = []
    for row in rows:
        product_id = row["id"]
        product_data = {"name": row["name"]}

        cursor.execute(
            "SELECT key, value FROM product_properties WHERE product_id = ?",
            (product_id,),
        )
        props = cursor.fetchall()
        for prop in props:
            product_data[prop["key"]] = prop["value"]

        products_list.append(product_data)

    return jsonify({"data": json.dumps(products_list)}), 200


@app.route("/upload", methods=["POST"])
def upload_product():
    body = request.get_json()
    if not body or "name" not in body or "data" not in body:
        return jsonify({"error": "Invalid upload query. 'name' and 'data' are required."}), 400

    name = body["name"]
    data_str = body["data"]

    if not isinstance(name, str) or not name.strip():
        return jsonify({"error": "Invalid upload query. 'name' must be a non-empty string."}), 400

    if not isinstance(data_str, str):
        return jsonify({"error": "Invalid upload query. 'data' must be a string."}), 400

    try:
        products_list = json.loads(data_str)
    except (json.JSONDecodeError, TypeError):
        return jsonify({"error": "Invalid upload query. 'data' must be valid JSON."}), 400

    if not isinstance(products_list, list):
        return jsonify({"error": "Invalid upload query. 'data' must be a JSON array."}), 400

    # Validate all entries
    for entry in products_list:
        if not isinstance(entry, dict):
            return jsonify({"error": "Invalid upload query. Each entry must be a JSON object."}), 400
        if "name" not in entry:
            return jsonify({"error": "Invalid upload query. Each entry must have a 'name' field."}), 400
        for key, value in entry.items():
            if not isinstance(value, str):
                return jsonify({"error": f"Invalid upload query. Property '{key}' must be a string."}), 400

    db = get_db()
    cursor = db.cursor()

    # Delete existing products with this name
    cursor.execute("SELECT id FROM products WHERE name = ?", (name,))
    existing_ids = [row["id"] for row in cursor.fetchall()]
    for pid in existing_ids:
        cursor.execute("DELETE FROM product_properties WHERE product_id = ?", (pid,))
        cursor.execute("DELETE FROM products WHERE id = ?", (pid,))

    # Insert new data
    for entry in products_list:
        entry_name = entry.get("name", name)
        cursor.execute("INSERT INTO products (name) VALUES (?)", (entry_name,))
        product_id = cursor.lastrowid
        for key, value in entry.items():
            if key == "name":
                continue
            cursor.execute(
                "INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)",
                (product_id, key, value),
            )

    db.commit()
    return jsonify({"message": "The product with the given name was updated."}), 200


@app.route("/search", methods=["GET"])
def search_products():
    query = request.args.get("query")
    if not query:
        return jsonify({"error": "Invalid search query. 'query' parameter is required."}), 400

    db = get_db()
    cursor = db.cursor()

    search_pattern = f"%{query}%"

    # Search in product name or any property value
    cursor.execute(
        """
        SELECT DISTINCT p.id, p.name FROM products p
        LEFT JOIN product_properties pp ON p.id = pp.product_id
        WHERE p.name LIKE ? OR pp.value LIKE ?
        """,
        (search_pattern, search_pattern),
    )
    matched_products = cursor.fetchall()

    results = []
    for row in matched_products:
        product_id = row["id"]
        product_data = {"name": row["name"]}

        cursor.execute(
            "SELECT key, value FROM product_properties WHERE product_id = ?",
            (product_id,),
        )
        props = cursor.fetchall()
        for prop in props:
            product_data[prop["key"]] = prop["value"]

        results.append(product_data)

    return jsonify({"results": results}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)