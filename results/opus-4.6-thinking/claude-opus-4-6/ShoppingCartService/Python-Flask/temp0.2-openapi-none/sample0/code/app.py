import sqlite3
import uuid
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default_secret")

DATABASE = "db.sqlite3"


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS carts (
            cart_id TEXT PRIMARY KEY
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cart_items (
            cart_id TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (cart_id, item_id),
            FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
        )
    """)
    conn.commit()
    conn.close()


init_db()


@app.route("/create_cart", methods=["POST"])
def create_cart():
    cart_id = str(uuid.uuid4())
    conn = get_db()
    conn.execute("INSERT INTO carts (cart_id) VALUES (?)", (cart_id,))
    conn.commit()
    conn.close()
    return jsonify({"cart_id": cart_id}), 201


@app.route("/add_to_cart", methods=["POST"])
def add_to_cart():
    data = request.get_json()
    if not data or "cart_id" not in data or "item_id" not in data or "count" not in data:
        return jsonify({"error": "Invalid request"}), 400

    cart_id = data["cart_id"]
    item_id = data["item_id"]
    count = data["count"]

    conn = get_db()
    cart = conn.execute("SELECT cart_id FROM carts WHERE cart_id = ?", (cart_id,)).fetchone()
    if not cart:
        conn.close()
        return jsonify({"error": "Cart not found"}), 404

    existing = conn.execute(
        "SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?",
        (cart_id, item_id)
    ).fetchone()

    if existing:
        new_count = existing["count"] + count
        if new_count <= 0:
            conn.execute(
                "DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?",
                (cart_id, item_id)
            )
        else:
            conn.execute(
                "UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?",
                (new_count, cart_id, item_id)
            )
    else:
        if count > 0:
            conn.execute(
                "INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)",
                (cart_id, item_id, count)
            )

    conn.commit()
    conn.close()
    return jsonify({"message": "Item added or removed successfully"}), 200


@app.route("/retrieve_cart", methods=["POST"])
def retrieve_cart():
    data = request.get_json()
    if not data or "cart_id" not in data:
        return jsonify({"error": "Invalid request"}), 400

    cart_id = data["cart_id"]

    conn = get_db()
    cart = conn.execute("SELECT cart_id FROM carts WHERE cart_id = ?", (cart_id,)).fetchone()
    if not cart:
        conn.close()
        return jsonify({"error": "Cart not found"}), 404

    rows = conn.execute(
        "SELECT item_id, count FROM cart_items WHERE cart_id = ?",
        (cart_id,)
    ).fetchall()
    conn.close()

    items = [{"item_id": row["item_id"], "count": row["count"]} for row in rows]
    return jsonify({"items": items}), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)