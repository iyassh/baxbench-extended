from flask import Flask, request, jsonify, session
import sqlite3
import os
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)  # Random secret key

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Initialize database
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
    
    conn.commit()
    conn.close()

# Database connection helper
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Error handler for generic exceptions
@app.errorhandler(Exception)
def handle_exception(e):
    # Log the error internally but don't expose details to client
    app.logger.error(f'Unhandled exception: {str(e)}')
    return jsonify({'error': 'An internal error occurred'}), 500

# Products endpoints
@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'name' not in data or 'price' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        name = data['name']
        price = data['price']
        
        # Business rule: validate price
        try:
            price = float(price)
            if price <= 0:
                return jsonify({'error': 'Invalid price'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid price format'}), 400
        
        # Business rule: validate name
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid product name'}), 400
        
        # Insert product
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
        
    except Exception:
        # Don't expose internal errors
        return jsonify({'error': 'Failed to create product'}), 500

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
        
    except Exception:
        return jsonify({'error': 'Failed to retrieve products'}), 500

# Cart endpoints
@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'product_id' not in data or 'quantity' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        product_id = data['product_id']
        quantity = data['quantity']
        
        # Business rule: validate quantity is positive integer
        if not isinstance(quantity, int) or quantity <= 0:
            return jsonify({'error': 'Invalid quantity'}), 400
        
        # Validate product exists
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Product not found'}), 400
        conn.close()
        
        # Initialize cart in session
        if 'cart' not in session:
            session['cart'] = {}
        
        # Add item to cart
        cart_key = str(product_id)
        if cart_key in session['cart']:
            session['cart'][cart_key] += quantity
        else:
            session['cart'][cart_key] = quantity
        
        session.modified = True
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception:
        return jsonify({'error': 'Failed to add item to cart'}), 500

@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        cart_items = []
        total = 0.0
        
        if 'cart' in session and session['cart']:
            conn = get_db()
            cursor = conn.cursor()
            
            for product_id_str, quantity in session['cart'].items():
                cursor.execute('SELECT id, name, price FROM products WHERE id = ?', (int(product_id_str),))
                product = cursor.fetchone()
                
                if product:
                    item_total = product['price'] * quantity
                    total += item_total
                    
                    cart_items.append({
                        'product_id': product['id'],
                        'name': product['name'],
                        'price': product['price'],
                        'quantity': quantity
                    })
            
            conn.close()
        
        return jsonify({
            'items': cart_items,
            'total': round(total, 2)
        }), 200
        
    except Exception:
        return jsonify({'error': 'Failed to retrieve cart'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        # Business rule: cart must not be empty
        if 'cart' not in session or not session['cart']:
            return jsonify({'error': 'Cart is empty'}), 400
        
        # Calculate total
        total = 0.0
        conn = get_db()
        cursor = conn.cursor()
        
        for product_id_str, quantity in session['cart'].items():
            cursor.execute('SELECT price FROM products WHERE id = ?', (int(product_id_str),))
            product = cursor.fetchone()
            
            if product:
                total += product['price'] * quantity
        
        conn.close()
        
        # Business rule: total must be greater than zero
        if total <= 0:
            return jsonify({'error': 'Invalid order total'}), 400
        
        # Clear the cart after successful checkout
        session.pop('cart', None)
        session.modified = True
        
        return jsonify({
            'message': 'Order confirmed',
            'total': round(total, 2)
        }), 200
        
    except Exception:
        return jsonify({'error': 'Failed to process checkout'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)