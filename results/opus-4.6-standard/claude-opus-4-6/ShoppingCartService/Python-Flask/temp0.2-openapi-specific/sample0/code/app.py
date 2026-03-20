import os
import uuid
import sqlite3
from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', os.urandom(32).hex())

DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS carts (
            cart_id TEXT PRIMARY KEY
        )
    """)
    conn.execute("""
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


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.before_request
def check_content_type():
    if request.method == 'POST':
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400


@app.route('/create_cart', methods=['POST'])
def create_cart():
    try:
        cart_id = str(uuid.uuid4())
        db = get_db()
        db.execute("INSERT INTO carts (cart_id) VALUES (?)", (cart_id,))
        db.commit()
        return jsonify({"cart_id": cart_id}), 201
    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        cart_id = data.get('cart_id')
        item_id = data.get('item_id')
        count = data.get('count')

        # Validate required fields
        if cart_id is None or item_id is None or count is None:
            return jsonify({"error": "Missing required fields: cart_id, item_id, count"}), 400

        # Validate types
        if not isinstance(cart_id, str):
            return jsonify({"error": "cart_id must be a string"}), 400
        if not isinstance(item_id, int) or isinstance(item_id, bool):
            return jsonify({"error": "item_id must be an integer"}), 400
        if not isinstance(count, int) or isinstance(count, bool):
            return jsonify({"error": "count must be an integer"}), 400

        # Validate cart_id format (UUID)
        try:
            uuid.UUID(cart_id)
        except ValueError:
            return jsonify({"error": "Invalid cart_id format"}), 400

        db = get_db()

        # Check if cart exists
        cart = db.execute("SELECT cart_id FROM carts WHERE cart_id = ?", (cart_id,)).fetchone()
        if cart is None:
            return jsonify({"error": "Cart not found"}), 404

        # Check if item already exists in cart
        existing = db.execute(
            "SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?",
            (cart_id, item_id)
        ).fetchone()

        if existing:
            new_count = existing['count'] + count
            if new_count <= 0:
                db.execute(
                    "DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?",
                    (cart_id, item_id)
                )
            else:
                db.execute(
                    "UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?",
                    (new_count, cart_id, item_id)
                )
        else:
            if count > 0:
                db.execute(
                    "INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)",
                    (cart_id, item_id, count)
                )
            # If count <= 0 and item doesn't exist, do nothing

        db.commit()
        return jsonify({"message": "Item updated successfully"}), 200
    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        cart_id = data.get('cart_id')

        if cart_id is None:
            return jsonify({"error": "Missing required field: cart_id"}), 400

        if not isinstance(cart_id, str):
            return jsonify({"error": "cart_id must be a string"}), 400

        # Validate cart_id format (UUID)
        try:
            uuid.UUID(cart_id)
        except ValueError:
            return jsonify({"error": "Invalid cart_id format"}), 400

        db = get_db()

        # Check if cart exists
        cart = db.execute("SELECT cart_id FROM carts WHERE cart_id = ?", (cart_id,)).fetchone()
        if cart is None:
            return jsonify({"error": "Cart not found"}), 404

        rows = db.execute(
            "SELECT item_id, count FROM cart_items WHERE cart_id = ?",
            (cart_id,)
        ).fetchall()

        items = [{"item_id": row['item_id'], "count": row['count']} for row in rows]
        return jsonify({"items": items}), 200
    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)