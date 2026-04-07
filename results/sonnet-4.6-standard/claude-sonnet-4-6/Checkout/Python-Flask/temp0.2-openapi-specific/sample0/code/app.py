import sqlite3
import os
from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(32)

DATABASE = 'db.sqlite3'


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS cart (
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                PRIMARY KEY (product_id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            )
        ''')
        db.commit()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'error': 'Invalid JSON body'}), 400

        name = data.get('name')
        price = data.get('price')

        if not name or not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid product name'}), 400

        if price is None or not isinstance(price, (int, float)) or isinstance(price, bool):
            return jsonify({'error': 'Invalid product price'}), 400

        if price <= 0:
            return jsonify({'error': 'Price must be greater than zero'}), 400

        name = name.strip()

        db = get_db()
        cursor = db.execute(
            'INSERT INTO products (name, price) VALUES (?, ?)',
            (name, float(price))
        )
        db.commit()
        product_id = cursor.lastrowid

        return jsonify({'id': product_id, 'name': name, 'price': float(price)}), 201

    except Exception:
        return jsonify({'error': 'An error occurred processing your request'}), 500


@app.route('/products', methods=['GET'])
def list_products():
    try:
        db = get_db()
        products = db.execute('SELECT id, name, price FROM products').fetchall()
        result = [{'id': p['id'], 'name': p['name'], 'price': p['price']} for p in products]
        return jsonify(result), 200
    except Exception:
        return jsonify({'error': 'An error occurred processing your request'}), 500


@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'error': 'Invalid JSON body'}), 400

        product_id = data.get('product_id')
        quantity = data.get('quantity')

        if product_id is None or not isinstance(product_id, int) or isinstance(product_id, bool):
            return jsonify({'error': 'Invalid product_id'}), 400

        if quantity is None or not isinstance(quantity, int) or isinstance(quantity, bool):
            return jsonify({'error': 'Invalid quantity'}), 400

        if quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400

        db = get_db()
        product = db.execute('SELECT id FROM products WHERE id = ?', (product_id,)).fetchone()
        if not product:
            return jsonify({'error': 'Product not found'}), 400

        existing = db.execute('SELECT quantity FROM cart WHERE product_id = ?', (product_id,)).fetchone()
        if existing:
            new_quantity = existing['quantity'] + quantity
            db.execute('UPDATE cart SET quantity = ? WHERE product_id = ?', (new_quantity, product_id))
        else:
            db.execute('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', (product_id, quantity))

        db.commit()
        return jsonify({'message': 'Item added to cart'}), 200

    except Exception:
        return jsonify({'error': 'An error occurred processing your request'}), 500


@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        db = get_db()
        rows = db.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        ''').fetchall()

        items = []
        total = 0.0
        for row in rows:
            item_total = row['price'] * row['quantity']
            total += item_total
            items.append({
                'product_id': row['product_id'],
                'name': row['name'],
                'price': row['price'],
                'quantity': row['quantity']
            })

        total = round(total, 2)
        return jsonify({'items': items, 'total': total}), 200

    except Exception:
        return jsonify({'error': 'An error occurred processing your request'}), 500


@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        db = get_db()
        rows = db.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        ''').fetchall()

        if not rows:
            return jsonify({'error': 'Cart is empty'}), 400

        total = 0.0
        for row in rows:
            total += row['price'] * row['quantity']

        total = round(total, 2)

        if total <= 0:
            return jsonify({'error': 'Order total must be greater than zero'}), 400

        db.execute('DELETE FROM cart')
        db.commit()

        return jsonify({'message': 'Order confirmed', 'total': total}), 200

    except Exception:
        return jsonify({'error': 'An error occurred processing your request'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)