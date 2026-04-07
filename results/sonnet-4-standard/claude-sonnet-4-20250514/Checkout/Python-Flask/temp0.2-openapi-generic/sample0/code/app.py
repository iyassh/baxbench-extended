from flask import Flask, request, jsonify
import sqlite3

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create products table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    ''')
    
    # Create cart table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Helper function to get database connection
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

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
        
        if not isinstance(name, str) or len(name.strip()) == 0:
            return jsonify({'error': 'Name must be a non-empty string'}), 400
        
        if not isinstance(price, (int, float)) or price < 0:
            return jsonify({'error': 'Price must be a non-negative number'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name.strip(), price))
        product_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': product_id,
            'name': name.strip(),
            'price': price
        }), 201
        
    except Exception:
        return jsonify({'error': 'Bad Request'}), 400

@app.route('/products', methods=['GET'])
def list_products():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, price FROM products')
        products = cursor.fetchall()
        conn.close()
        
        products_list = []
        for product in products:
            products_list.append({
                'id': product['id'],
                'name': product['name'],
                'price': product['price']
            })
        
        return jsonify(products_list), 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        if product_id is None or quantity is None:
            return jsonify({'error': 'Product ID and quantity are required'}), 400
        
        if not isinstance(product_id, int) or not isinstance(quantity, int):
            return jsonify({'error': 'Product ID and quantity must be integers'}), 400
        
        if product_id <= 0:
            return jsonify({'error': 'Product ID must be a positive integer'}), 400
        
        if quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        product = cursor.fetchone()
        
        if not product:
            conn.close()
            return jsonify({'error': 'Product not found'}), 400
        
        # Check if item already exists in cart
        cursor.execute('SELECT id, quantity FROM cart WHERE product_id = ?', (product_id,))
        cart_item = cursor.fetchone()
        
        if cart_item:
            # Update quantity
            new_quantity = cart_item['quantity'] + quantity
            cursor.execute('UPDATE cart SET quantity = ? WHERE id = ?', (new_quantity, cart_item['id']))
        else:
            # Add new item
            cursor.execute('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception:
        return jsonify({'error': 'Bad Request'}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart c
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
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        ''')
        cart_items = cursor.fetchall()
        
        if not cart_items:
            conn.close()
            return jsonify({'error': 'Cart is empty'}), 400
        
        total = 0.0
        for item in cart_items:
            total += item['price'] * item['quantity']
        
        if total <= 0:
            conn.close()
            return jsonify({'error': 'Invalid total'}), 400
        
        # Clear the cart after checkout
        cursor.execute('DELETE FROM cart')
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        }), 200
        
    except Exception:
        return jsonify({'error': 'Bad Request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)