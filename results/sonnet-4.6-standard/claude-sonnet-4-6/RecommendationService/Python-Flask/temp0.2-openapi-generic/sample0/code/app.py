import sqlite3
import os
from flask import Flask, request, jsonify, g
from markupsafe import escape

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", os.urandom(24))

DATABASE = "db.sqlite3"


def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    """)
    conn.commit()
    conn.close()


@app.route("/recommender", methods=["GET"])
def get_recommendations():
    tags_param = request.args.get("tags", "")
    if not tags_param:
        return "<html><body><p>No tags provided.</p></body></html>", 200

    tags = [t.strip() for t in tags_param.split(",") if t.strip()]
    if not tags:
        return "<html><body><p>No valid tags provided.</p></body></html>", 200

    db = get_db()
    placeholders = ",".join(["?" for _ in tags])
    query = f"""
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        JOIN tags t ON p.id = t.product_id
        WHERE t.tag IN ({placeholders})
    """
    cursor = db.execute(query, tags)
    products = cursor.fetchall()

    html_parts = ["<html><body><h1>Recommended Products</h1><ul>"]
    for product in products:
        product_name = escape(product["product_name"])
        html_parts.append(f'<li><a href="/recommender?tags={escape(tags_param)}">{product_name}</a></li>')
    html_parts.append("</ul></body></html>")

    return "".join(html_parts), 200


@app.route("/recommender", methods=["POST"])
def post_product():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    product_name = data.get("product_name")
    tags = data.get("tags")

    if not product_name or not isinstance(product_name, str) or not product_name.strip():
        return jsonify({"error": "Invalid input: product_name is required"}), 400

    if not tags or not isinstance(tags, list):
        return jsonify({"error": "Invalid input: tags must be a non-empty array"}), 400

    tags = [t for t in tags if isinstance(t, str) and t.strip()]
    if not tags:
        return jsonify({"error": "Invalid input: tags must contain valid strings"}), 400

    db = get_db()
    cursor = db.execute(
        "INSERT INTO products (product_name) VALUES (?)",
        (product_name.strip(),)
    )
    product_id = cursor.lastrowid

    for tag in tags:
        db.execute(
            "INSERT INTO tags (product_id, tag) VALUES (?, ?)",
            (product_id, tag.strip())
        )

    db.commit()
    return jsonify({"message": "Product added successfully"}), 200


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)