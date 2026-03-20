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
    return jsonify({"message": "Product successfully added", "id": product_id}), 201


@app.route("/download", methods=["GET"])
def download_product():
    name = request.args.get("name")
    if not name:
        return jsonify({"error": "Missing 'name' query parameter."}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id FROM products WHERE name = ?", (name,))
    rows = cursor.fetchall()

    if not rows:
        return jsonify({"data": json.dumps([])}), 200

    results = []
    for row in rows:
        product_id = row["id"]
        product_data = {"name": name}
        cursor.execute(
            "SELECT key, value FROM product_properties WHERE product_id = ?",
            (product_id,),
        )
        props = cursor.fetchall()
        for prop in props:
            product_data[prop["key"]] = prop["value"]
        results.append(product_data)

    return jsonify({"data": json.dumps(results)}), 200


@app.route("/upload", methods=["POST"])
def upload_product():
    body = request.get_json()
    if not body or "name" not in body or "data" not in body:
        return jsonify({"error": "Invalid upload query. 'name' and 'data' are required."}), 400

    name = body["name"]
    data_str = body["data"]

    if not isinstance(name, str) or not name.strip():
        return jsonify({"error": "Invalid upload query. 'name' must be a non-empty string."}), 400

    try:
        data_list = json.loads(data_str)
    except (json.JSONDecodeError, TypeError):
        return jsonify({"error": "Invalid upload query. 'data' must be valid JSON."}), 400

    if not isinstance(data_list, list):
        return jsonify({"error": "Invalid upload query. 'data' must be a JSON array."}), 400

    db = get_db()
    cursor = db.cursor()

    # Delete existing products with this name
    cursor.execute("SELECT id FROM products WHERE name = ?", (name,))
    existing = cursor.fetchall()
    for row in existing:
        cursor.execute("DELETE FROM product_properties WHERE product_id = ?", (row["id"],))
    cursor.execute("DELETE FROM products WHERE name = ?", (name,))

    # Insert new data
    for item in data_list:
        if not isinstance(item, dict):
            db.rollback()
            return jsonify({"error": "Invalid upload query. Each item must be an object."}), 400

        cursor.execute("INSERT INTO products (name) VALUES (?)", (name,))
        product_id = cursor.lastrowid

        for key, value in item.items():
            if key == "name":
                continue
            if not isinstance(value, str):
                db.rollback()
                return jsonify({"error": f"Invalid upload query. Property '{key}' must be a string."}), 400
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

    # Find products where name matches or any property value matches
    cursor.execute("""
        SELECT DISTINCT p.id, p.name
        FROM products p
        LEFT JOIN product_properties pp ON p.id = pp.product_id
        WHERE p.name LIKE ? OR pp.value LIKE ?
    """, (search_pattern, search_pattern))

    product_rows = cursor.fetchall()

    results = []
    for row in product_rows:
        product = {"name": row["name"]}
        cursor.execute(
            "SELECT key, value FROM product_properties WHERE product_id = ?",
            (row["id"],),
        )
        props = cursor.fetchall()
        for prop in props:
            product[prop["key"]] = prop["value"]
        results.append(product)

    return jsonify({"results": results}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)