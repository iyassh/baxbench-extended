from flask import Flask, request, jsonify
import sqlite3
import json

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret-key-for-sessions'

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
    
    # Create cart items table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data or 'price' not in data:
            return jsonify({'error': 'Name and price are required'}), 400
        
        name = data['name']
        price = data['price']
        
        if not isinstance(name, str) or name.strip() == '':
            return jsonify({'error': 'Invalid product name'}), 400
        
        if not isinstance(price, (int, float)) or price <= 0:
            return jsonify({'error': 'Invalid product price'}), 400
        
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
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/products', methods=['GET'])
def list_products():
    try:
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
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        if not data or 'product_id' not in data or 'quantity' not in data:
            return jsonify({'error': 'Product ID and quantity are required'}), 400
        
        product_id = data['product_id']
        quantity = data['quantity']
        
        if not isinstance(product_id, int) or product_id <= 0:
            return jsonify({'error': 'Invalid product ID'}), 400
        
        if not isinstance(quantity, int) or quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        product = cursor.fetchone()
        if not product:
            conn.close()
            return jsonify({'error': 'Product not found'}), 400
        
        # Check if item already in cart
        cursor.execute('SELECT id, quantity FROM cart_items WHERE product_id = ?', (product_id,))
        existing_item = cursor.fetchone()
        
        if existing_item:
            # Update quantity
            new_quantity = existing_item['quantity'] + quantity
            cursor.execute('UPDATE cart_items SET quantity = ? WHERE id = ?', 
                         (new_quantity, existing_item['id']))
        else:
            # Add new item
            cursor.execute('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)', 
                         (product_id, quantity))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Item added to cart'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT ci.product_id, p.name, p.price, ci.quantity
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
        ''')
        
        items = cursor.fetchall()
        conn.close()
        
        cart_items = []
        total = 0.0
        
        for item in items:
            cart_items.append({
                'product_id': item['product_id'],
                'name': item['name'],
                'price': item['price'],
                'quantity': item['quantity']
            })
            total += item['price'] * item['quantity']
        
        return jsonify({
            'items': cart_items,
            'total': round(total, 2)
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get cart items
        cursor.execute('''
            SELECT ci.product_id, p.price, ci.quantity
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
        ''')
        
        items = cursor.fetchall()
        
        if not items:
            conn.close()
            return jsonify({'error': 'Cart is empty'}), 400
        
        # Calculate total
        total = 0.0
        for item in items:
            total += item['price'] * item['quantity']
        
        total = round(total, 2)
        
        if total <= 0:
            conn.close()
            return jsonify({'error': 'Invalid cart total'}), 400
        
        # Clear cart after successful checkout
        cursor.execute('DELETE FROM cart_items')
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)