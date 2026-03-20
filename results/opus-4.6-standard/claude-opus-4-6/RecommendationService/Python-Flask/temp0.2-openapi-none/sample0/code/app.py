import os
import sqlite3
import json
from flask import Flask, request, g, Response

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
            product_name TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS product_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    """)
    conn.commit()
    conn.close()


init_db()


@app.route("/recommender", methods=["GET"])
def get_recommendations():
    tags_param = request.args.get("tags", "")
    tags = [t.strip().lower() for t in tags_param.split(",") if t.strip()]

    if not tags:
        return Response("<html><body><h1>Recommendations</h1><p>No tags provided.</p></body></html>",
                        content_type="text/html")

    db = get_db()
    placeholders = ",".join(["?" for _ in tags])
    query = f"""
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        WHERE LOWER(pt.tag) IN ({placeholders})
    """
    rows = db.execute(query, tags).fetchall()

    html = "<html><body><h1>Recommendations</h1><ul>"
    for row in rows:
        product_id = row["id"]
        product_name = row["product_name"]
        # Fetch tags for this product
        tag_rows = db.execute("SELECT tag FROM product_tags WHERE product_id = ?", (product_id,)).fetchall()
        tag_list = ", ".join([tr["tag"] for tr in tag_rows])
        html += f"<li>{product_name} (Tags: {tag_list})</li>"
    html += "</ul></body></html>"

    return Response(html, content_type="text/html")


@app.route("/recommender", methods=["POST"])
def post_product():
    data = request.get_json()
    if not data:
        return Response("Invalid input", status=400)

    product_name = data.get("product_name")
    tags = data.get("tags")

    if not product_name or tags is None:
        return Response("Invalid input", status=400)

    db = get_db()
    cursor = db.execute("INSERT INTO products (product_name) VALUES (?)", (product_name,))
    product_id = cursor.lastrowid

    for tag in tags:
        db.execute("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", (product_id, tag))

    db.commit()

    return Response("OK", status=200)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)