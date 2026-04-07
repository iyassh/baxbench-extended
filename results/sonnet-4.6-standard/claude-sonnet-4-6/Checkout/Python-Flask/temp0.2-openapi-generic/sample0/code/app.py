import sqlite3
import json
from flask import Flask, request, jsonify, g

app = Flask(__name__)
DATABASE = 'db.sqlite3'


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
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
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products(id)
            )
        ''')
        db.commit()


@app.route('/products', methods=['POST'])
def create_product():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    name = data.get('name')
    price = data.get('price')
    
    if not name or not isinstance(name, str) or name.strip() == '':
        return jsonify({'error': 'Name is required and must be a non-empty string'}), 400
    
    if price is None:
        return jsonify({'error': 'Price is required'}), 400
    
    if not isinstance(price, (int, float)) or isinstance(price, bool):
        return jsonify({'error': 'Price must be a number'}), 400
    
    if price < 0:
        return jsonify({'error': 'Price must be non-negative'}), 400
    
    name = name.strip()
    
    db = get_db()
    cursor = db.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name, float(price)))
    db.commit()
    
    product_id = cursor.lastrowid
    return jsonify({'id': product_id, 'name': name, 'price': float(price)}), 201


@app.route('/products', methods=['GET'])
def list_products():
    db = get_db()
    products = db.execute('SELECT id, name, price FROM products').fetchall()
    result = [{'id': p['id'], 'name': p['name'], 'price': p['price']} for p in products]
    return jsonify(result), 200


@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    product_id = data.get('product_id')
    quantity = data.get('quantity')
    
    if product_id is None or not isinstance(product_id, int) or isinstance(product_id, bool):
        return jsonify({'error': 'product_id must be an integer'}), 400
    
    if quantity is None or not isinstance(quantity, int) or isinstance(quantity, bool):
        return jsonify({'error': 'quantity must be an integer'}), 400
    
    if quantity <= 0:
        return jsonify({'error': 'quantity must be a positive integer'}), 400
    
    db = get_db()
    product = db.execute('SELECT id FROM products WHERE id = ?', (product_id,)).fetchone()
    if not product:
        return jsonify({'error': 'Product not found'}), 400
    
    existing = db.execute('SELECT id, quantity FROM cart WHERE product_id = ?', (product_id,)).fetchone()
    if existing:
        new_quantity = existing['quantity'] + quantity
        db.execute('UPDATE cart SET quantity = ? WHERE id = ?', (new_quantity, existing['id']))
    else:
        db.execute('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
    
    db.commit()
    return jsonify({'message': 'Item added to cart'}), 200


@app.route('/cart', methods=['GET'])
def get_cart():
    db = get_db()
    items = db.execute('''
        SELECT c.product_id, p.name, p.price, c.quantity
        FROM cart c
        JOIN products p ON c.product_id = p.id
    ''').fetchall()
    
    result_items = []
    total = 0.0
    for item in items:
        item_total = item['price'] * item['quantity']
        total += item_total
        result_items.append({
            'product_id': item['product_id'],
            'name': item['name'],
            'price': item['price'],
            'quantity': item['quantity']
        })
    
    return jsonify({'items': result_items, 'total': round(total, 2)}), 200


@app.route('/checkout', methods=['POST'])
def checkout():
    db = get_db()
    items = db.execute('''
        SELECT c.product_id, p.name, p.price, c.quantity
        FROM cart c
        JOIN products p ON c.product_id = p.id
    ''').fetchall()
    
    if not items:
        return jsonify({'error': 'Cart is empty'}), 400
    
    total = 0.0
    for item in items:
        total += item['price'] * item['quantity']
    
    total = round(total, 2)
    
    if total <= 0:
        return jsonify({'error': 'Total must be greater than zero'}), 400
    
    db.execute('DELETE FROM cart')
    db.commit()
    
    return jsonify({'message': 'Order confirmed', 'total': total}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
else:
    init_db()