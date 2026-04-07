import sqlite3
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
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                PRIMARY KEY (product_id)
            )
        ''')
        db.commit()

@app.route('/products', methods=['POST'])
def create_product():
    data = request.get_json()
    if not data or 'name' not in data or 'price' not in data:
        return jsonify({'error': 'name and price are required'}), 400
    name = data['name']
    price = data['price']
    if not isinstance(name, str) or not name:
        return jsonify({'error': 'name must be a non-empty string'}), 400
    if not isinstance(price, (int, float)) or isinstance(price, bool) or price < 0:
        return jsonify({'error': 'price must be a non-negative number'}), 400
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
    if not data or 'product_id' not in data or 'quantity' not in data:
        return jsonify({'error': 'product_id and quantity are required'}), 400
    product_id = data['product_id']
    quantity = data['quantity']
    if not isinstance(product_id, int) or isinstance(product_id, bool):
        return jsonify({'error': 'product_id must be an integer'}), 400
    if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity <= 0:
        return jsonify({'error': 'quantity must be a positive integer'}), 400
    db = get_db()
    product = db.execute('SELECT id FROM products WHERE id = ?', (product_id,)).fetchone()
    if product is None:
        return jsonify({'error': 'Product not found'}), 400
    existing = db.execute('SELECT quantity FROM cart WHERE product_id = ?', (product_id,)).fetchone()
    if existing:
        db.execute('UPDATE cart SET quantity = quantity + ? WHERE product_id = ?', (quantity, product_id))
    else:
        db.execute('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
    db.commit()
    return jsonify({'message': 'Item added to cart'}), 200

@app.route('/cart', methods=['GET'])
def get_cart():
    db = get_db()
    rows = db.execute('''
        SELECT c.product_id, p.name, p.price, c.quantity
        FROM cart c
        JOIN products p ON c.product_id = p.id
    ''').fetchall()
    items = []
    total = 0.0
    for row in rows:
        item = {
            'product_id': row['product_id'],
            'name': row['name'],
            'price': row['price'],
            'quantity': row['quantity']
        }
        total += row['price'] * row['quantity']
        items.append(item)
    return jsonify({'items': items, 'total': round(total, 2)}), 200

@app.route('/checkout', methods=['POST'])
def checkout():
    db = get_db()
    rows = db.execute('''
        SELECT c.product_id, p.price, c.quantity
        FROM cart c
        JOIN products p ON c.product_id = p.id
    ''').fetchall()
    if not rows:
        return jsonify({'error': 'Cart is empty'}), 400
    total = sum(row['price'] * row['quantity'] for row in rows)
    if total <= 0:
        return jsonify({'error': 'Total must be greater than zero'}), 400
    db.execute('DELETE FROM cart')
    db.commit()
    return jsonify({'message': 'Order confirmed', 'total': round(total, 2)}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)