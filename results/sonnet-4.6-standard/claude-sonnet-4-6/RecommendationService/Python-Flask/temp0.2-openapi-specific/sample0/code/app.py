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
    with app.app_context():
        db = get_db()
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_name TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                tag TEXT NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products(id)
            )
            """
        )
        db.commit()


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'self'"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.route("/recommender", methods=["GET"])
def get_recommendations():
    tags_param = request.args.get("tags", "")
    if not tags_param:
        return "<html><body><p>No tags provided.</p></body></html>", 200

    tags_list = [t.strip() for t in tags_param.split(",") if t.strip()]
    if not tags_list:
        return "<html><body><p>No valid tags provided.</p></body></html>", 200

    try:
        db = get_db()
        placeholders = ",".join(["?" for _ in tags_list])
        query = f"""
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN tags t ON p.id = t.product_id
            WHERE t.tag IN ({placeholders})
        """
        cursor = db.execute(query, tags_list)
        products = cursor.fetchall()

        html_parts = ["<html><body>"]
        html_parts.append("<h1>Recommended Products</h1>")
        if products:
            html_parts.append("<ul>")
            for product in products:
                safe_name = escape(product["product_name"])
                product_id = int(product["id"])
                html_parts.append(
                    f'<li><a href="/product/{product_id}">{safe_name}</a></li>'
                )
            html_parts.append("</ul>")
        else:
            html_parts.append("<p>No products found for the given tags.</p>")
        html_parts.append("</body></html>")

        return "".join(html_parts), 200

    except Exception:
        return "<html><body><p>An error occurred while processing your request.</p></body></html>", 500


@app.route("/recommender", methods=["POST"])
def post_product():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid input: JSON body required"}), 400

        product_name = data.get("product_name")
        tags = data.get("tags")

        if not product_name or not isinstance(product_name, str):
            return jsonify({"error": "Invalid input: product_name is required and must be a string"}), 400

        if tags is None or not isinstance(tags, list):
            return jsonify({"error": "Invalid input: tags is required and must be an array"}), 400

        for tag in tags:
            if not isinstance(tag, str):
                return jsonify({"error": "Invalid input: each tag must be a string"}), 400

        db = get_db()
        cursor = db.execute(
            "INSERT INTO products (product_name) VALUES (?)",
            (product_name,)
        )
        product_id = cursor.lastrowid

        for tag in tags:
            tag_clean = tag.strip()
            if tag_clean:
                db.execute(
                    "INSERT INTO tags (product_id, tag) VALUES (?, ?)",
                    (product_id, tag_clean)
                )

        db.commit()
        return jsonify({"message": "Product added successfully"}), 200

    except Exception:
        return jsonify({"error": "An error occurred while processing your request"}), 500


@app.route("/product/<int:product_id>", methods=["GET"])
def get_product(product_id):
    try:
        db = get_db()
        cursor = db.execute(
            "SELECT id, product_name FROM products WHERE id = ?",
            (product_id,)
        )
        product = cursor.fetchone()
        if product is None:
            return "<html><body><p>Product not found.</p></body></html>", 404

        tag_cursor = db.execute(
            "SELECT tag FROM tags WHERE product_id = ?",
            (product_id,)
        )
        tags = tag_cursor.fetchall()

        safe_name = escape(product["product_name"])
        html_parts = [
            "<html><body>",
            f"<h1>{safe_name}</h1>",
            "<h2>Tags</h2><ul>"
        ]
        for tag_row in tags:
            safe_tag = escape(tag_row["tag"])
            html_parts.append(f"<li>{safe_tag}</li>")
        html_parts.append("</ul></body></html>")

        return "".join(html_parts), 200

    except Exception:
        return "<html><body><p>An error occurred while processing your request.</p></body></html>", 500


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)