from flask import Flask, request, jsonify
import sqlite3
from contextlib import contextmanager

app = Flask(__name__)

@contextmanager
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS cart (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products(id)
            )
        ''')
        
        conn.commit()

init_db()

@app.route('/products', methods=['POST'])
def create_product():
    data = request.get_json()
    
    if not data or 'name' not in data or 'price' not in data:
        return jsonify({'error': 'Name and price are required'}), 400
    
    name = data.get('name')
    price = data.get('price')
    
    if not isinstance(name, str) or not name.strip():
        return jsonify({'error': 'Name must be a non-empty string'}), 400
    
    try:
        price = float(price)
        if price < 0:
            return jsonify({'error': 'Price must be non-negative'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'Price must be a valid number'}), 400
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name, price))
        conn.commit()
        product_id = cursor.lastrowid
    
    return jsonify({
        'id': product_id,
        'name': name,
        'price': price
    }), 201

@app.route('/products', methods=['GET'])
def list_products():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, price FROM products')
        products = cursor.fetchall()
    
    result = []
    for product in products:
        result.append({
            'id': product['id'],
            'name': product['name'],
            'price': product['price']
        })
    
    return jsonify(result), 200

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    data = request.get_json()
    
    if not data or 'product_id' not in data or 'quantity' not in data:
        return jsonify({'error': 'product_id and quantity are required'}), 400
    
    try:
        product_id = int(data.get('product_id'))
        quantity = int(data.get('quantity'))
    except (ValueError, TypeError):
        return jsonify({'error': 'product_id and quantity must be integers'}), 400
    
    if quantity <= 0:
        return jsonify({'error': 'Quantity must be a positive integer'}), 400
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        product = cursor.fetchone()
        
        if not product:
            return jsonify({'error': 'Product not found'}), 400
        
        cursor.execute('SELECT id, quantity FROM cart WHERE product_id = ?', (product_id,))
        cart_item = cursor.fetchone()
        
        if cart_item:
            new_quantity = cart_item['quantity'] + quantity
            cursor.execute('UPDATE cart SET quantity = ? WHERE id = ?', (new_quantity, cart_item['id']))
        else:
            cursor.execute('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
        
        conn.commit()
    
    return jsonify({'message': 'Item added to cart'}), 200

@app.route('/cart', methods=['GET'])
def get_cart():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        ''')
        cart_items = cursor.fetchall()
    
    items = []
    total = 0.0
    
    for item in cart_items:
        item_dict = {
            'product_id': item['product_id'],
            'name': item['name'],
            'price': item['price'],
            'quantity': item['quantity']
        }
        items.append(item_dict)
        total += item['price'] * item['quantity']
    
    return jsonify({
        'items': items,
        'total': total
    }), 200

@app.route('/checkout', methods=['POST'])
def checkout():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        ''')
        cart_items = cursor.fetchall()
        
        if not cart_items:
            return jsonify({'error': 'Cart is empty'}), 400
        
        total = 0.0
        for item in cart_items:
            total += item['price'] * item['quantity']
        
        if total <= 0:
            return jsonify({'error': 'Total must be greater than zero'}), 400
        
        cursor.execute('DELETE FROM cart')
        conn.commit()
    
    return jsonify({
        'message': 'Order confirmed',
        'total': total
    }), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)