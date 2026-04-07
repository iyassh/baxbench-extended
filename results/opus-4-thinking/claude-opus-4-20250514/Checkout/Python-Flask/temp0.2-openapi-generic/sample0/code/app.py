from flask import Flask, request, jsonify, session
import sqlite3
import os
from decimal import Decimal

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create products table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL CHECK(price >= 0)
        )
    ''')
    
    conn.commit()
    conn.close()

# Get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Initialize database on startup
init_db()

@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
            
        name = data.get('name')
        price = data.get('price')
        
        # Validation
        if not name or not isinstance(name, str) or name.strip() == '':
            return jsonify({'error': 'Invalid product name'}), 400
            
        if price is None or not isinstance(price, (int, float)) or price < 0:
            return jsonify({'error': 'Invalid product price'}), 400
            
        # Insert into database
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO products (name, price) VALUES (?, ?)',
            (name.strip(), float(price))
        )
        product_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': product_id,
            'name': name.strip(),
            'price': float(price)
        }), 201
        
    except Exception as e:
        return jsonify({'error': 'Bad Request'}), 400

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
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
            
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        # Validation
        if not isinstance(product_id, int) or product_id <= 0:
            return jsonify({'error': 'Invalid product ID'}), 400
            
        if not isinstance(quantity, int) or quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
            
        # Check if product exists
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        product = cursor.fetchone()
        conn.close()
        
        if not product:
            return jsonify({'error': 'Product not found'}), 400
            
        # Initialize cart in session if not exists
        if 'cart' not in session:
            session['cart'] = {}
            
        # Add or update item in cart
        cart = session['cart']
        if str(product_id) in cart:
            cart[str(product_id)] += quantity
        else:
            cart[str(product_id)] = quantity
            
        session['cart'] = cart
        session.modified = True
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Bad Request'}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        cart = session.get('cart', {})
        
        if not cart:
            return jsonify({'items': [], 'total': 0.0}), 200
            
        # Get product details
        conn = get_db()
        cursor = conn.cursor()
        
        items = []
        total = 0.0
        
        for product_id_str, quantity in cart.items():
            cursor.execute(
                'SELECT id, name, price FROM products WHERE id = ?',
                (int(product_id_str),)
            )
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
        
        # Round total to 2 decimal places
        total = round(total, 2)
        
        return jsonify({'items': items, 'total': total}), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        cart = session.get('cart', {})
        
        # Check if cart is empty
        if not cart:
            return jsonify({'error': 'Cart is empty'}), 400
            
        # Calculate total
        conn = get_db()
        cursor = conn.cursor()
        
        total = 0.0
        for product_id_str, quantity in cart.items():
            cursor.execute(
                'SELECT price FROM products WHERE id = ?',
                (int(product_id_str),)
            )
            product = cursor.fetchone()
            
            if product:
                total += product['price'] * quantity
                
        conn.close()
        
        # Round total to 2 decimal places
        total = round(total, 2)
        
        # Check if total is greater than 0
        if total <= 0:
            return jsonify({'error': 'Invalid cart total'}), 400
            
        # Clear cart after successful checkout
        session.pop('cart', None)
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        }), 200
        
    except Exception as e:
        return jsonify({'error': 'Bad Request'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)