import sqlite3
import os
import html
from flask import Flask, request, jsonify, g

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
        db.execute("""
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_name TEXT NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                tag TEXT NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products(id)
            )
        """)
        db.commit()


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.route("/recommender", methods=["GET"])
def get_recommendations():
    tags_param = request.args.get("tags", "")
    if not tags_param:
        return "<html><body><p>No tags provided.</p></body></html>", 200, {"Content-Type": "text/html"}

    tags_list = [t.strip() for t in tags_param.split(",") if t.strip()]
    if not tags_list:
        return "<html><body><p>No valid tags provided.</p></body></html>", 200, {"Content-Type": "text/html"}

    try:
        db = get_db()
        placeholders = ",".join(["?" for _ in tags_list])
        query = f"""
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN tags t ON p.id = t.product_id
            WHERE t.tag IN ({placeholders})
        """
        rows = db.execute(query, tags_list).fetchall()

        escaped_tags = html.escape(tags_param)
        html_parts = [
            "<!DOCTYPE html>",
            "<html>",
            "<head><meta charset='UTF-8'><title>Product Recommendations</title></head>",
            "<body>",
            f"<h1>Products matching tags: {escaped_tags}</h1>",
        ]

        if rows:
            html_parts.append("<ul>")
            for row in rows:
                product_name = html.escape(str(row["product_name"]))
                product_id = int(row["id"])
                html_parts.append(
                    f'<li><a href="/product/{product_id}">{product_name}</a></li>'
                )
            html_parts.append("</ul>")
        else:
            html_parts.append("<p>No products found for the given tags.</p>")

        html_parts.extend(["</body>", "</html>"])
        return "\n".join(html_parts), 200, {"Content-Type": "text/html"}

    except Exception:
        return "<html><body><p>An error occurred while processing your request.</p></body></html>", 500, {"Content-Type": "text/html"}


@app.route("/recommender", methods=["POST"])
def post_product():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid input: JSON body required"}), 400

        product_name = data.get("product_name")
        tags = data.get("tags")

        if not product_name or not isinstance(product_name, str) or not product_name.strip():
            return jsonify({"error": "Invalid input: product_name is required and must be a non-empty string"}), 400

        if tags is None or not isinstance(tags, list):
            return jsonify({"error": "Invalid input: tags must be an array"}), 400

        cleaned_tags = []
        for tag in tags:
            if not isinstance(tag, str):
                return jsonify({"error": "Invalid input: each tag must be a string"}), 400
            tag_stripped = tag.strip()
            if tag_stripped:
                cleaned_tags.append(tag_stripped)

        db = get_db()
        cursor = db.execute(
            "INSERT INTO products (product_name) VALUES (?)",
            (product_name.strip(),)
        )
        product_id = cursor.lastrowid

        for tag in cleaned_tags:
            db.execute(
                "INSERT INTO tags (product_id, tag) VALUES (?, ?)",
                (product_id, tag)
            )

        db.commit()
        return jsonify({"message": "Product added successfully", "product_id": product_id}), 200

    except Exception:
        return jsonify({"error": "An error occurred while processing your request"}), 500


@app.route("/product/<int:product_id>", methods=["GET"])
def get_product(product_id):
    try:
        db = get_db()
        product = db.execute(
            "SELECT id, product_name FROM products WHERE id = ?",
            (product_id,)
        ).fetchone()

        if not product:
            return "<html><body><p>Product not found.</p></body></html>", 404, {"Content-Type": "text/html"}

        tags = db.execute(
            "SELECT tag FROM tags WHERE product_id = ?",
            (product_id,)
        ).fetchall()

        product_name = html.escape(str(product["product_name"]))
        tag_list = [html.escape(str(t["tag"])) for t in tags]

        html_content = f"""<!DOCTYPE html>
<html>
<head><meta charset='UTF-8'><title>{product_name}</title></head>
<body>
<h1>{product_name}</h1>
<p>Tags: {", ".join(tag_list) if tag_list else "None"}</p>
<a href="/recommender">Back to search</a>
</body>
</html>"""
        return html_content, 200, {"Content-Type": "text/html"}

    except Exception:
        return "<html><body><p>An error occurred while processing your request.</p></body></html>", 500, {"Content-Type": "text/html"}


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)