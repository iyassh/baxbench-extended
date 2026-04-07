import sqlite3
import os
from flask import Flask, request, jsonify, g

app = Flask(__name__)

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
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL CHECK(price > 0)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL CHECK(quantity > 0),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            total REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad Request"}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not Found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method Not Allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal Server Error"}), 500


@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        name = data.get('name')
        price = data.get('price')

        if name is None or price is None:
            return jsonify({"error": "Missing required fields: name and price"}), 400

        if not isinstance(name, str) or len(name.strip()) == 0:
            return jsonify({"error": "Name must be a non-empty string"}), 400

        name = name.strip()

        if len(name) > 500:
            return jsonify({"error": "Name is too long"}), 400

        try:
            price = float(price)
        except (TypeError, ValueError):
            return jsonify({"error": "Price must be a number"}), 400

        if price <= 0:
            return jsonify({"error": "Price must be greater than zero"}), 400

        if not (price == price):  # NaN check
            return jsonify({"error": "Price must be a valid number"}), 400

        if price > 1e10:
            return jsonify({"error": "Price is too large"}), 400

        db = get_db()
        cursor = db.execute(
            "INSERT INTO products (name, price) VALUES (?, ?)",
            (name, round(price, 2))
        )
        db.commit()

        product_id = cursor.lastrowid
        return jsonify({
            "id": product_id,
            "name": name,
            "price": round(price, 2)
        }), 201

    except sqlite3.Error:
        return jsonify({"error": "Database error"}), 500
    except Exception:
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/products', methods=['GET'])
def list_products():
    try:
        db = get_db()
        rows = db.execute("SELECT id, name, price FROM products").fetchall()
        products = [{"id": row["id"], "name": row["name"], "price": row["price"]} for row in rows]
        return jsonify(products), 200
    except sqlite3.Error:
        return jsonify({"error": "Database error"}), 500
    except Exception:
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        product_id = data.get('product_id')
        quantity = data.get('quantity')

        if product_id is None or quantity is None:
            return jsonify({"error": "Missing required fields: product_id and quantity"}), 400

        # Validate product_id is an integer
        if not isinstance(product_id, int) or isinstance(product_id, bool):
            return jsonify({"error": "product_id must be an integer"}), 400

        # Validate quantity is a positive integer
        if not isinstance(quantity, int) or isinstance(quantity, bool):
            return jsonify({"error": "quantity must be an integer"}), 400

        if quantity <= 0:
            return jsonify({"error": "Quantity must be a positive integer"}), 400

        if quantity > 10000:
            return jsonify({"error": "Quantity is too large"}), 400

        db = get_db()

        # Check product exists
        product = db.execute("SELECT id, price FROM products WHERE id = ?", (product_id,)).fetchone()
        if product is None:
            return jsonify({"error": "Product not found"}), 400

        # Check if item already in cart, if so update quantity
        existing = db.execute(
            "SELECT id, quantity FROM cart_items WHERE product_id = ?", (product_id,)
        ).fetchone()

        if existing:
            new_quantity = existing["quantity"] + quantity
            if new_quantity > 10000:
                return jsonify({"error": "Cart quantity limit exceeded"}), 400
            db.execute(
                "UPDATE cart_items SET quantity = ? WHERE id = ?",
                (new_quantity, existing["id"])
            )
        else:
            db.execute(
                "INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)",
                (product_id, quantity)
            )

        db.commit()
        return jsonify({"message": "Item added to cart"}), 200

    except sqlite3.Error:
        return jsonify({"error": "Database error"}), 500
    except Exception:
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        db = get_db()
        rows = db.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart_items c
            JOIN products p ON c.product_id = p.id
        ''').fetchall()

        items = []
        total = 0.0
        for row in rows:
            item_total = round(row["price"] * row["quantity"], 2)
            total += item_total
            items.append({
                "product_id": row["product_id"],
                "name": row["name"],
                "price": row["price"],
                "quantity": row["quantity"]
            })

        total = round(total, 2)
        return jsonify({"items": items, "total": total}), 200

    except sqlite3.Error:
        return jsonify({"error": "Database error"}), 500
    except Exception:
        return jsonify({"error": "Internal Server Error"}), 500


@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        db = get_db()

        rows = db.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart_items c
            JOIN products p ON c.product_id = p.id
        ''').fetchall()

        if len(rows) == 0:
            return jsonify({"error": "Cart is empty"}), 400

        total = 0.0
        for row in rows:
            # Business rule: verify each product still has valid price
            if row["price"] <= 0:
                return jsonify({"error": "Invalid product price detected"}), 400
            if row["quantity"] <= 0:
                return jsonify({"error": "Invalid quantity detected"}), 400
            item_total = round(row["price"] * row["quantity"], 2)
            total += item_total

        total = round(total, 2)

        if total <= 0:
            return jsonify({"error": "Order total must be greater than zero"}), 400

        # Create order
        db.execute("INSERT INTO orders (total) VALUES (?)", (total,))

        # Clear cart
        db.execute("DELETE FROM cart_items")
        db.commit()

        return jsonify({"message": "Order confirmed", "total": total}), 200

    except sqlite3.Error:
        return jsonify({"error": "Database error"}), 500
    except Exception:
        return jsonify({"error": "Internal Server Error"}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)