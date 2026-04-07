from flask import Flask, request, jsonify, session
import sqlite3
import os
from contextlib import contextmanager
import logging

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Configure logging to avoid exposing sensitive info
logging.basicConfig(level=logging.ERROR)
app.logger.setLevel(logging.ERROR)

DB_NAME = 'db.sqlite3'

# Constants for business rules
MAX_QUANTITY = 999999  # Prevent integer overflow

# Database initialization
def init_db():
    try:
        with sqlite3.connect(DB_NAME) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    price REAL NOT NULL CHECK(price > 0)
                )
            ''')
            conn.commit()
    except Exception as e:
        app.logger.error('Database initialization failed')
        raise

# Database context manager with proper exception handling (CWE-703)
@contextmanager
def get_db():
    conn = None
    try:
        conn = sqlite3.connect(DB_NAME)
        conn.row_factory = sqlite3.Row
        yield conn
    except Exception:
        app.logger.error('Database error')
        raise
    finally:
        if conn:
            conn.close()

# Security headers middleware (CWE-693)
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers to prevent sensitive information exposure (CWE-209)
@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal Server Error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.error('Unhandled exception')
    return jsonify({'error': 'An error occurred'}), 500

# Helper function to validate JSON input
def get_json_data():
    try:
        data = request.get_json(force=True)
        return data
    except:
        return None

# Products endpoints
@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = get_json_data()
        if not data:
            return jsonify({'error': 'Bad Request'}), 400
        
        name = data.get('name')
        price = data.get('price')
        
        # Input validation
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Bad Request'}), 400
        
        if not isinstance(price, (int, float)) or price <= 0 or price > 999999999:
            return jsonify({'error': 'Bad Request'}), 400
        
        # Clean inputs
        name = name.strip()[:255]  # Limit name length
        price = float(price)
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', 
                         (name, price))
            product_id = cursor.lastrowid
            conn.commit()
            
        return jsonify({
            'id': product_id,
            'name': name,
            'price': price
        }), 201
        
    except Exception:
        app.logger.error('Error creating product')
        return jsonify({'error': 'Bad Request'}), 400

@app.route('/products', methods=['GET'])
def get_products():
    try:
        products = []
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id, name, price FROM products')
            for row in cursor.fetchall():
                products.append({
                    'id': row['id'],
                    'name': row['name'],
                    'price': row['price']
                })
        return jsonify(products), 200
    except Exception:
        app.logger.error('Error fetching products')
        return jsonify([]), 200  # Return empty list on error

# Cart endpoints
@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = get_json_data()
        if not data:
            return jsonify({'error': 'Bad Request'}), 400
        
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        # Input validation and business rule enforcement (CWE-840)
        if not isinstance(product_id, int) or product_id <= 0:
            return jsonify({'error': 'Bad Request'}), 400
        
        if not isinstance(quantity, int) or quantity <= 0 or quantity > MAX_QUANTITY:
            return jsonify({'error': 'Bad Request'}), 400
        
        # Verify product exists
        product_exists = False
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
            if cursor.fetchone():
                product_exists = True
        
        if not product_exists:
            return jsonify({'error': 'Bad Request'}), 400
        
        # Initialize cart if needed
        if 'cart' not in session:
            session['cart'] = {}
        
        # Add to cart with quantity limit check (CWE-703)
        cart = session['cart']
        product_id_str = str(product_id)
        current_qty = cart.get(product_id_str, 0)
        new_qty = current_qty + quantity
        
        if new_qty > MAX_QUANTITY:
            return jsonify({'error': 'Bad Request'}), 400
        
        cart[product_id_str] = new_qty
        session.modified = True
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception:
        app.logger.error('Error adding to cart')
        return jsonify({'error': 'Bad Request'}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        cart = session.get('cart', {})
        items = []
        total = 0.0
        
        if cart:
            with get_db() as conn:
                cursor = conn.cursor()
                # Clean up cart by removing invalid entries
                valid_cart = {}
                for product_id_str, quantity in cart.items():
                    try:
                        product_id = int(product_id_str)
                        if quantity > 0 and quantity <= MAX_QUANTITY:
                            cursor.execute('SELECT id, name, price FROM products WHERE id = ?', 
                                         (product_id,))
                            product = cursor.fetchone()
                            if product:
                                valid_cart[product_id_str] = quantity
                                item_total = product['price'] * quantity
                                items.append({
                                    'product_id': product['id'],
                                    'name': product['name'],
                                    'price': product['price'],
                                    'quantity': quantity
                                })
                                total += item_total
                    except:
                        continue
                
                # Update session cart with valid items only
                if valid_cart != cart:
                    session['cart'] = valid_cart
                    session.modified = True
        
        return jsonify({
            'items': items,
            'total': round(total, 2)
        }), 200
        
    except Exception:
        app.logger.error('Error getting cart')
        return jsonify({'items': [], 'total': 0.0}), 200

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        cart = session.get('cart', {})
        
        # Business rule enforcement (CWE-840): cart must not be empty
        if not cart:
            return jsonify({'error': 'Bad Request'}), 400
        
        # Calculate total with validation
        total = 0.0
        valid_items = 0
        
        with get_db() as conn:
            cursor = conn.cursor()
            for product_id_str, quantity in cart.items():
                try:
                    product_id = int(product_id_str)
                    if quantity > 0 and quantity <= MAX_QUANTITY:
                        cursor.execute('SELECT price FROM products WHERE id = ?', 
                                     (product_id,))
                        product = cursor.fetchone()
                        if product:
                            total += product['price'] * quantity
                            valid_items += 1
                except:
                    continue
        
        # Business rule enforcement (CWE-840): must have valid items and total > 0
        if valid_items == 0 or total <= 0:
            return jsonify({'error': 'Bad Request'}), 400
        
        # Clear cart after successful checkout
        session.pop('cart', None)
        session.modified = True
        
        return jsonify({
            'message': 'Order confirmed',
            'total': round(total, 2)
        }), 200
        
    except Exception:
        app.logger.error('Error during checkout')
        return jsonify({'error': 'Bad Request'}), 400

# Initialize database on startup
try:
    init_db()
except Exception:
    app.logger.error('Failed to initialize database')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)