from flask import Flask, request, jsonify
import sqlite3
import math
from contextlib import contextmanager

app = Flask(__name__)

# Database setup
DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables"""
    conn = sqlite3.connect(DB_NAME)
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

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

# Security headers middleware
@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Error handlers
@app.errorhandler(400)
def bad_request(error):
    """Handle 400 errors without exposing sensitive information"""
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors without exposing sensitive information"""
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing sensitive information"""
    return jsonify({'error': 'Internal Server Error'}), 500

# Routes
@app.route('/products', methods=['POST'])
def create_product():
    """Create a new product"""
    try:
        data = request.get_json()
        
        # Validate input
        if not data:
            return jsonify({'error': 'Bad Request'}), 400
        
        name = data.get('name')
        price = data.get('price')
        
        # Validate name
        if name is None or not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Bad Request'}), 400
        
        # Validate price is provided
        if price is None:
            return jsonify({'error': 'Bad Request'}), 400
        
        # Validate price is a valid non-negative number
        try:
            price = float(price)
            if price < 0 or not math.isfinite(price):
                return jsonify({'error': 'Bad Request'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Bad Request'}), 400
        
        # Insert into database
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name, price))
            conn.commit()
            product_id = cursor.lastrowid
        
        return jsonify({
            'id': product_id,
            'name': name,
            'price': price
        }), 201
    
    except Exception:
        return jsonify({'error': 'Bad Request'}), 400

@app.route('/products', methods=['GET'])
def list_products():
    """List all products"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id, name, price FROM products')
            products = cursor.fetchall()
        
        return jsonify([
            {
                'id': product['id'],
                'name': product['name'],
                'price': product['price']
            }
            for product in products
        ]), 200
    
    except Exception:
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    """Add item to cart"""
    try:
        data = request.get_json()
        
        # Validate input
        if not data:
            return jsonify({'error': 'Bad Request'}), 400
        
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        if product_id is None or quantity is None:
            return jsonify({'error': 'Bad Request'}), 400
        
        # Validate product_id and quantity are positive integers
        try:
            product_id = int(product_id)
            quantity = int(quantity)
            
            # Business rule: product_id and quantity must be positive integers
            if product_id <= 0 or quantity <= 0:
                return jsonify({'error': 'Bad Request'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Bad Request'}), 400
        
        # Check if product exists
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
            product = cursor.fetchone()
            
            if not product:
                return jsonify({'error': 'Bad Request'}), 400
            
            # Check if item already in cart
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
        
        return jsonify({'message': 'Item added to cart'}), 200
    
    except Exception:
        return jsonify({'error': 'Bad Request'}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    """Get cart contents"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT c.product_id, p.name, p.price, c.quantity
                FROM cart c
                JOIN products p ON c.product_id = p.id
            ''')
            items = cursor.fetchall()
        
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
            'total': total
        }), 200
    
    except Exception:
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    """Process checkout"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get cart items
            cursor.execute('''
                SELECT c.product_id, p.price, c.quantity
                FROM cart c
                JOIN products p ON c.product_id = p.id
            ''')
            items = cursor.fetchall()
            
            # Business rule: cart must not be empty
            if not items:
                return jsonify({'error': 'Bad Request'}), 400
            
            # Calculate total
            total = 0.0
            for item in items:
                total += item['price'] * item['quantity']
            
            # Business rule: total must be greater than zero
            if total <= 0:
                return jsonify({'error': 'Bad Request'}), 400
            
            # Clear cart after successful checkout
            cursor.execute('DELETE FROM cart')
            conn.commit()
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        }), 200
    
    except Exception:
        return jsonify({'error': 'Bad Request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)