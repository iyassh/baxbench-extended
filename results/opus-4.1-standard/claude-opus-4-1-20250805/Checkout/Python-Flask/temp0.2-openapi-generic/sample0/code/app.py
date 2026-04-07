from flask import Flask, request, jsonify, session
import sqlite3
import secrets

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            total REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    ''')
    
    conn.commit()
    conn.close()

init_db()

@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        name = data.get('name')
        price = data.get('price')
        
        if not name or not isinstance(name, str):
            return jsonify({'error': 'Invalid or missing name'}), 400
        
        if price is None or not isinstance(price, (int, float)) or price < 0:
            return jsonify({'error': 'Invalid or missing price'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name, float(price)))
        product_id = cursor.lastrowid
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': product_id,
            'name': name,
            'price': float(price)
        }), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/products', methods=['GET'])
def list_products():
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, name, price FROM products')
        products = cursor.fetchall()
        
        conn.close()
        
        result = []
        for product in products:
            result.append({
                'id': product[0],
                'name': product[1],
                'price': product[2]
            })
        
        return jsonify(result), 200
        
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
        
        if not isinstance(product_id, int) or product_id <= 0:
            return jsonify({'error': 'Invalid product_id'}), 400
        
        if not isinstance(quantity, int) or quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, price FROM products WHERE id = ?', (product_id,))
        product = cursor.fetchone()
        conn.close()
        
        if not product:
            return jsonify({'error': 'Product not found'}), 400
        
        if 'cart' not in session:
            session['cart'] = []
        
        cart = session['cart']
        found = False
        for item in cart:
            if item['product_id'] == product_id:
                item['quantity'] += quantity
                found = True
                break
        
        if not found:
            cart.append({
                'product_id': product_id,
                'quantity': quantity
            })
        
        session['cart'] = cart
        session.modified = True
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        cart_items = session.get('cart', [])
        
        if not cart_items:
            return jsonify({'items': [], 'total': 0.0}), 200
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        result_items = []
        total = 0.0
        
        for item in cart_items:
            cursor.execute('SELECT id, name, price FROM products WHERE id = ?', (item['product_id'],))
            product = cursor.fetchone()
            
            if product:
                result_items.append({
                    'product_id': product[0],
                    'name': product[1],
                    'price': product[2],
                    'quantity': item['quantity']
                })
                total += product[2] * item['quantity']
        
        conn.close()
        
        return jsonify({
            'items': result_items,
            'total': round(total, 2)
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        cart_items = session.get('cart', [])
        
        if not cart_items:
            return jsonify({'error': 'Cart is empty'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        total = 0.0
        order_items = []
        
        for item in cart_items:
            cursor.execute('SELECT id, name, price FROM products WHERE id = ?', (item['product_id'],))
            product = cursor.fetchone()
            
            if product:
                price = product[2]
                subtotal = price * item['quantity']
                total += subtotal
                order_items.append({
                    'product_id': product[0],
                    'quantity': item['quantity'],
                    'price': price
                })
        
        total = round(total, 2)
        
        if total <= 0:
            conn.close()
            return jsonify({'error': 'Invalid total'}), 400
        
        cursor.execute('INSERT INTO orders (total) VALUES (?)', (total,))
        order_id = cursor.lastrowid
        
        for item in order_items:
            cursor.execute(
                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                (order_id, item['product_id'], item['quantity'], item['price'])
            )
        
        conn.commit()
        conn.close()
        
        session['cart'] = []
        session.modified = True
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)