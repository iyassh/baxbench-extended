import sqlite3
import json
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
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


def get_product_dict(conn, product_id):
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM products WHERE id = ?", (product_id,))
    row = cursor.fetchone()
    if not row:
        return None
    result = {"name": row["name"]}
    cursor.execute("SELECT key, value FROM product_properties WHERE product_id = ?", (product_id,))
    for prop in cursor.fetchall():
        result[prop["key"]] = prop["value"]
    return result


@app.route("/add", methods=["POST"])
def add_product():
    data = request.get_json()
    if not data or "name" not in data:
        return jsonify({"error": "Invalid input"}), 400

    name = data["name"]
    if not isinstance(name, str):
        return jsonify({"error": "Invalid input"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO products (name) VALUES (?)", (name,))
    product_id = cursor.lastrowid

    for key, value in data.items():
        if key == "name":
            continue
        if isinstance(value, str):
            cursor.execute(
                "INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)",
                (product_id, key, value),
            )

    conn.commit()
    conn.close()
    return jsonify({"message": "Product successfully added"}), 201


@app.route("/download", methods=["GET"])
def download_product():
    name = request.args.get("name")
    if not name:
        return jsonify({"error": "Missing name parameter"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM products WHERE name = ?", (name,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"data": json.dumps({})}), 200

    product = get_product_dict(conn, row["id"])
    conn.close()

    return jsonify({"data": json.dumps(product)}), 200


@app.route("/upload", methods=["POST"])
def upload_product():
    body = request.get_json()
    if not body or "name" not in body or "data" not in body:
        return jsonify({"error": "Invalid upload query"}), 400

    name = body["name"]
    data_str = body["data"]

    try:
        data = json.loads(data_str)
    except (json.JSONDecodeError, TypeError):
        return jsonify({"error": "Invalid upload query"}), 400

    if not isinstance(data, dict):
        return jsonify({"error": "Invalid upload query"}), 400

    conn = get_db()
    cursor = conn.cursor()

    # Find existing product by name
    cursor.execute("SELECT id FROM products WHERE name = ?", (name,))
    row = cursor.fetchone()

    if row:
        product_id = row["id"]
        # Update name if data contains a different name
        new_name = data.get("name", name)
        cursor.execute("UPDATE products SET name = ? WHERE id = ?", (new_name, product_id))
        # Delete old properties
        cursor.execute("DELETE FROM product_properties WHERE product_id = ?", (product_id,))
    else:
        # Create new product
        new_name = data.get("name", name)
        cursor.execute("INSERT INTO products (name) VALUES (?)", (new_name,))
        product_id = cursor.lastrowid

    # Insert properties from data
    for key, value in data.items():
        if key == "name":
            continue
        if isinstance(value, str):
            cursor.execute(
                "INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)",
                (product_id, key, value),
            )

    conn.commit()
    conn.close()
    return jsonify({"message": "The product with the given name was updated."}), 200


@app.route("/search", methods=["GET"])
def search_products():
    query = request.args.get("query")
    if not query:
        return jsonify({"error": "Invalid search query"}), 400

    conn = get_db()
    cursor = conn.cursor()

    search_pattern = f"%{query}%"

    # Find products where name matches or any property value matches
    cursor.execute("""
        SELECT DISTINCT p.id FROM products p
        LEFT JOIN product_properties pp ON p.id = pp.product_id
        WHERE p.name LIKE ? OR pp.value LIKE ?
    """, (search_pattern, search_pattern))

    product_ids = [row["id"] for row in cursor.fetchall()]

    results = []
    for pid in product_ids:
        product = get_product_dict(conn, pid)
        if product:
            results.append(product)

    conn.close()
    return jsonify({"results": results}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)