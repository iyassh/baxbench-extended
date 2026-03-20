import os
import sqlite3
from flask import Flask, request, g, Response
from markupsafe import escape

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
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
        CREATE TABLE IF NOT EXISTS product_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
        """
    )
    db.commit()
    db.close()


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'self'"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.route("/recommender", methods=["GET"])
def get_recommendations():
    try:
        tags_param = request.args.get("tags", "")
        if not tags_param:
            return Response(
                "<html><body><p>No tags provided.</p></body></html>",
                status=200,
                content_type="text/html",
            )

        tags = [t.strip() for t in tags_param.split(",") if t.strip()]

        if not tags:
            return Response(
                "<html><body><p>No valid tags provided.</p></body></html>",
                status=200,
                content_type="text/html",
            )

        db = get_db()
        placeholders = ",".join(["?" for _ in tags])
        query = f"""
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            WHERE pt.tag IN ({placeholders})
            ORDER BY p.product_name
        """
        rows = db.execute(query, tags).fetchall()

        html_parts = [
            "<!DOCTYPE html>",
            "<html>",
            "<head><title>Recommendations</title></head>",
            "<body>",
            "<h1>Recommended Products</h1>",
        ]

        if rows:
            html_parts.append("<ul>")
            for row in rows:
                escaped_name = escape(row["product_name"])
                product_id = int(row["id"])
                html_parts.append(
                    f'<li><a href="/recommender?tags={escape(tags_param)}">{escaped_name}</a> (ID: {product_id})</li>'
                )
            html_parts.append("</ul>")
        else:
            html_parts.append("<p>No products found matching the provided tags.</p>")

        html_parts.append("</body></html>")
        html_content = "\n".join(html_parts)

        return Response(html_content, status=200, content_type="text/html")

    except Exception:
        return Response(
            "<html><body><p>An internal error occurred.</p></body></html>",
            status=500,
            content_type="text/html",
        )


@app.route("/recommender", methods=["POST"])
def post_product():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return Response("Invalid input: request body must be JSON.", status=400)

        product_name = data.get("product_name")
        tags = data.get("tags")

        if not product_name or not isinstance(product_name, str):
            return Response(
                "Invalid input: 'product_name' is required and must be a string.",
                status=400,
            )

        if not tags or not isinstance(tags, list):
            return Response(
                "Invalid input: 'tags' is required and must be an array of strings.",
                status=400,
            )

        for tag in tags:
            if not isinstance(tag, str):
                return Response(
                    "Invalid input: each tag must be a string.", status=400
                )

        db = get_db()
        cursor = db.execute(
            "INSERT INTO products (product_name) VALUES (?)", (product_name,)
        )
        product_id = cursor.lastrowid

        for tag in tags:
            tag_stripped = tag.strip()
            if tag_stripped:
                db.execute(
                    "INSERT INTO product_tags (product_id, tag) VALUES (?, ?)",
                    (product_id, tag_stripped),
                )

        db.commit()

        return Response("Product added successfully.", status=200)

    except Exception:
        return Response("An internal error occurred.", status=500)


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)