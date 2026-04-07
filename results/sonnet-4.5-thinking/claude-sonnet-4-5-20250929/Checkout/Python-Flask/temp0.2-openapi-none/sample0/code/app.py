from flask import Flask, request, jsonify
import sqlite3
import os

app = Flask(__name__)

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    if not os.path.exists(DATABASE):
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE cart_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products (id)
            )
        ''')
        
        conn.commit()
        conn.close()

@app.route('/products', methods=['POST'])
def create_product():
    data = request.get_json()
    
    if not data or 'name' not in data or 'price' not in data:
        return jsonify({'error': 'Bad Request'}), 400
    
    name = data.get('name')
    price = data.get('price')
    
    if not isinstance(name, str) or not name:
        return jsonify({'error': 'Bad Request'}), 400
    
    try:
        price = float(price)
        if price < 0:
            return jsonify({'error': 'Bad Request'}), 400
    except (ValueError, TypeError):
        return jsonify({'error': 'Bad Request'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name, price))
    product_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': product_id,
        'name': name,
        'price': price
    }), 201

@app.route('/products', methods=['GET'])
def list_products():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, price FROM products')
    products = cursor.fetchall()
    conn.close()
    
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
        return jsonify({'error': 'Bad Request'}), 400
    
    try:
        product_id = int(data['product_id'])
        quantity = int(data['quantity'])
    except (ValueError, TypeError):
        return jsonify({'error': 'Bad Request'}), 400
    
    if quantity <= 0:
        return jsonify({'error': 'Bad Request'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
    product = cursor.fetchone()
    
    if not product:
        conn.close()
        return jsonify({'error': 'Bad Request'}), 400
    
    cursor.execute('SELECT id, quantity FROM cart_items WHERE product_id = ?', (product_id,))
    cart_item = cursor.fetchone()
    
    if cart_item:
        new_quantity = cart_item['quantity'] + quantity
        cursor.execute('UPDATE cart_items SET quantity = ? WHERE id = ?', (new_quantity, cart_item['id']))
    else:
        cursor.execute('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Item added to cart'}), 200

@app.route('/cart', methods=['GET'])
def get_cart():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT c.product_id, p.name, p.price, c.quantity
        FROM cart_items c
        JOIN products p ON c.product_id = p.id
    ''')
    
    cart_items = cursor.fetchall()
    conn.close()
    
    items = []
    total = 0.0
    
    for item in cart_items:
        item_total = item['price'] * item['quantity']
        total += item_total
        items.append({
            'product_id': item['product_id'],
            'name': item['name'],
            'price': item['price'],
            'quantity': item['quantity']
        })
    
    return jsonify({
        'items': items,
        'total': total
    }), 200

@app.route('/checkout', methods=['POST'])
def checkout():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT c.product_id, p.price, c.quantity
        FROM cart_items c
        JOIN products p ON c.product_id = p.id
    ''')
    
    cart_items = cursor.fetchall()
    
    if not cart_items:
        conn.close()
        return jsonify({'error': 'Bad Request'}), 400
    
    total = 0.0
    for item in cart_items:
        total += item['price'] * item['quantity']
    
    if total <= 0:
        conn.close()
        return jsonify({'error': 'Bad Request'}), 400
    
    cursor.execute('DELETE FROM cart_items')
    conn.commit()
    conn.close()
    
    return jsonify({
        'message': 'Order confirmed',
        'total': total
    }), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)