from flask import Flask, request, jsonify, session
import sqlite3
import os
from contextlib import contextmanager

app = Flask(__name__)
app.secret_key = os.urandom(24)
DATABASE = 'db.sqlite3'

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL
            )
        ''')
        conn.commit()

@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

@app.route('/products', methods=['POST'])
def create_product():
    data = request.get_json()
    if not data or 'name' not in data or 'price' not in data:
        return jsonify({'error': 'Name and price are required'}), 400
    
    name = data['name']
    price = data['price']
    
    if not isinstance(name, str) or not name.strip():
        return jsonify({'error': 'Invalid name'}), 400
    
    try:
        price = float(price)
        if price < 0:
            return jsonify({'error': 'Price must be non-negative'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid price'}), 400
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name.strip(), price))
        product_id = cursor.lastrowid
        conn.commit()
    
    return jsonify({
        'id': product_id,
        'name': name.strip(),
        'price': price
    }), 201

@app.route('/products', methods=['GET'])
def list_products():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, price FROM products ORDER BY id')
        products = [{'id': row['id'], 'name': row['name'], 'price': row['price']} for row in cursor.fetchall()]
    
    return jsonify(products)

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    data = request.get_json()
    if not data or 'product_id' not in data or 'quantity' not in data:
        return jsonify({'error': 'Product ID and quantity are required'}), 400
    
    product_id = data['product_id']
    quantity = data['quantity']
    
    if not isinstance(product_id, int) or product_id <= 0:
        return jsonify({'error': 'Product ID must be a positive integer'}), 400
    
    if not isinstance(quantity, int) or quantity <= 0:
        return jsonify({'error': 'Quantity must be a positive integer'}), 400
    
    # Check if product exists
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        if not cursor.fetchone():
            return jsonify({'error': 'Product not found'}), 400
    
    # Add to session cart
    if 'cart' not in session:
        session['cart'] = {}
    
    cart = session['cart']
    product_id_str = str(product_id)
    cart[product_id_str] = cart.get(product_id_str, 0) + quantity
    session['cart'] = cart
    
    return jsonify({'message': 'Item added to cart'})

@app.route('/cart', methods=['GET'])
def get_cart():
    cart = session.get('cart', {})
    
    if not cart:
        return jsonify({'items': [], 'total': 0})
    
    items = []
    total = 0.0
    
    with get_db() as conn:
        cursor = conn.cursor()
        for product_id_str, quantity in cart.items():
            try:
                product_id = int(product_id_str)
                if quantity <= 0:
                    continue
            except ValueError:
                continue
                
            cursor.execute('SELECT id, name, price FROM products WHERE id = ?', (product_id,))
            product = cursor.fetchone()
            
            if product:
                total += product['price'] * quantity
                items.append({
                    'product_id': product['id'],
                    'name': product['name'],
                    'price': product['price'],
                    'quantity': quantity
                })
    
    return jsonify({'items': items, 'total': total})

@app.route('/checkout', methods=['POST'])
def checkout():
    cart = session.get('cart', {})
    
    if not cart:
        return jsonify({'error': 'Cart is empty'}), 400
    
    # Calculate total
    total = 0.0
    valid_items = False
    
    with get_db() as conn:
        cursor = conn.cursor()
        for product_id_str, quantity in cart.items():
            try:
                product_id = int(product_id_str)
                if quantity <= 0:
                    continue
            except ValueError:
                continue
                
            cursor.execute('SELECT price FROM products WHERE id = ?', (product_id,))
            product = cursor.fetchone()
            if product:
                total += product['price'] * quantity
                valid_items = True
    
    if not valid_items or total <= 0:
        return jsonify({'error': 'Cart is empty or has invalid total'}), 400
    
    # Clear cart after successful checkout
    session['cart'] = {}
    
    return jsonify({
        'message': 'Order confirmed',
        'total': total
    })

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)