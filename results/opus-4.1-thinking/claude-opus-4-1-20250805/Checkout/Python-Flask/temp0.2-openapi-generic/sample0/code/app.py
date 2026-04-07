from flask import Flask, request, jsonify, session
import sqlite3
import secrets

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)

DB_NAME = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL CHECK(price >= 0)
        )
    ''')
    conn.commit()
    conn.close()

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

init_db()

@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        name = data.get('name')
        price = data.get('price')
        
        if not name or price is None:
            return jsonify({'error': 'Name and price are required'}), 400
        
        if not isinstance(name, str) or name.strip() == '':
            return jsonify({'error': 'Name must be a non-empty string'}), 400
        
        try:
            price = float(price)
            if price < 0:
                return jsonify({'error': 'Price must be non-negative'}), 400
        except (TypeError, ValueError):
            return jsonify({'error': 'Price must be a number'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO products (name, price) VALUES (?, ?)',
            (name.strip(), price)
        )
        product_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': product_id,
            'name': name.strip(),
            'price': price
        }), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/products', methods=['GET'])
def list_products():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, price FROM products')
        products = []
        
        for row in cursor.fetchall():
            products.append({
                'id': row['id'],
                'name': row['name'],
                'price': row['price']
            })
        
        conn.close()
        return jsonify(products), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        if product_id is None or quantity is None:
            return jsonify({'error': 'product_id and quantity are required'}), 400
        
        try:
            product_id = int(product_id)
            quantity = int(quantity)
        except (TypeError, ValueError):
            return jsonify({'error': 'product_id and quantity must be integers'}), 400
        
        if quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, price FROM products WHERE id = ?', (product_id,))
        product = cursor.fetchone()
        conn.close()
        
        if not product:
            return jsonify({'error': 'Product not found'}), 400
        
        if 'cart' not in session:
            session['cart'] = {}
        
        cart = session['cart']
        product_id_str = str(product_id)
        
        if product_id_str in cart:
            cart[product_id_str] += quantity
        else:
            cart[product_id_str] = quantity
        
        session['cart'] = cart
        session.modified = True
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        cart = session.get('cart', {})
        
        if not cart:
            return jsonify({'items': [], 'total': 0.0}), 200
        
        conn = get_db()
        cursor = conn.cursor()
        
        items = []
        total = 0.0
        
        for product_id_str, quantity in cart.items():
            product_id = int(product_id_str)
            cursor.execute('SELECT id, name, price FROM products WHERE id = ?', (product_id,))
            product = cursor.fetchone()
            
            if product:
                item_total = product['price'] * quantity
                items.append({
                    'product_id': product['id'],
                    'name': product['name'],
                    'price': product['price'],
                    'quantity': quantity
                })
                total += item_total
        
        conn.close()
        
        total = round(total, 2)
        
        return jsonify({'items': items, 'total': total}), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        cart = session.get('cart', {})
        
        if not cart:
            return jsonify({'error': 'Cart is empty'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        total = 0.0
        
        for product_id_str, quantity in cart.items():
            product_id = int(product_id_str)
            cursor.execute('SELECT price FROM products WHERE id = ?', (product_id,))
            product = cursor.fetchone()
            
            if product:
                total += product['price'] * quantity
        
        conn.close()
        
        total = round(total, 2)
        
        if total <= 0:
            return jsonify({'error': 'Total must be greater than zero'}), 400
        
        session['cart'] = {}
        session.modified = True
        
        return jsonify({'message': 'Order confirmed', 'total': total}), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)