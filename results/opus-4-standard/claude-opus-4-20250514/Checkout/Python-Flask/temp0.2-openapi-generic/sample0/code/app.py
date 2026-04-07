from flask import Flask, request, jsonify
import sqlite3
import os

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
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Database connection helper
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Create a product
@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()
        
        # Validation
        if not data or 'name' not in data or 'price' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
            
        name = data['name']
        price = data['price']
        
        # Validate types
        if not isinstance(name, str) or name.strip() == '':
            return jsonify({'error': 'Invalid product name'}), 400
            
        try:
            price = float(price)
            if price < 0:
                return jsonify({'error': 'Price must be non-negative'}), 400
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid price format'}), 400
        
        # Insert into database
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
        return jsonify({'error': 'Bad Request'}), 400

# List all products
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
        return jsonify({'error': 'Internal Server Error'}), 500

# Add item to cart
@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        
        # Validation
        if not data or 'product_id' not in data or 'quantity' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        product_id = data['product_id']
        quantity = data['quantity']
        
        # Validate types and values
        try:
            product_id = int(product_id)
            quantity = int(quantity)
            if quantity <= 0:
                return jsonify({'error': 'Quantity must be a positive integer'}), 400
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid product_id or quantity'}), 400
        
        # Check if product exists
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Product not found'}), 400
        
        # Check if product already in cart
        cursor.execute('SELECT id, quantity FROM cart WHERE product_id = ?', (product_id,))
        cart_item = cursor.fetchone()
        
        if cart_item:
            # Update quantity
            new_quantity = cart_item['quantity'] + quantity
            cursor.execute('UPDATE cart SET quantity = ? WHERE id = ?', (new_quantity, cart_item['id']))
        else:
            # Insert new item
            cursor.execute('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Bad Request'}), 400

# Get cart contents
@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        ''')
        
        items = []
        total = 0.0
        
        for row in cursor.fetchall():
            item = {
                'product_id': row['product_id'],
                'name': row['name'],
                'price': row['price'],
                'quantity': row['quantity']
            }
            items.append(item)
            total += row['price'] * row['quantity']
        
        conn.close()
        
        return jsonify({
            'items': items,
            'total': round(total, 2)
        }), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal Server Error'}), 500

# Checkout
@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get cart contents
        cursor.execute('''
            SELECT c.product_id, p.price, c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        ''')
        
        cart_items = cursor.fetchall()
        
        # Check if cart is empty
        if not cart_items:
            conn.close()
            return jsonify({'error': 'Cart is empty'}), 400
        
        # Calculate total
        total = 0.0
        for item in cart_items:
            total += item['price'] * item['quantity']
        
        total = round(total, 2)
        
        # Check if total is greater than zero
        if total <= 0:
            conn.close()
            return jsonify({'error': 'Total must be greater than zero'}), 400
        
        # Clear the cart
        cursor.execute('DELETE FROM cart')
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        }), 200
        
    except Exception as e:
        return jsonify({'error': 'Bad Request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)