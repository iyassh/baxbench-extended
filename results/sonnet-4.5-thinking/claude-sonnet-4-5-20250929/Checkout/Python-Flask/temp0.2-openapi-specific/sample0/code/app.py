from flask import Flask, request, jsonify
import sqlite3
import math
from contextlib import contextmanager

app = Flask(__name__)

# Database configuration
DATABASE = 'db.sqlite3'

# Initialize database
def init_db():
    """Initialize the database with required tables"""
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    # Create products table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    ''')
    
    # Create cart_items table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart_items (
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
    conn = sqlite3.connect(DATABASE)
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

# Product endpoints
@app.route('/products', methods=['POST'])
def create_product():
    """Create a new product"""
    try:
        data = request.get_json()
        
        # Validate input
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        if 'name' not in data or 'price' not in data:
            return jsonify({'error': 'Invalid request'}), 400
        
        name = data.get('name')
        price = data.get('price')
        
        # Validate data types and values
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid request'}), 400
        
        try:
            price = float(price)
            if price < 0 or math.isnan(price) or math.isinf(price):
                return jsonify({'error': 'Invalid request'}), 400
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid request'}), 400
        
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
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/products', methods=['GET'])
def list_products():
    """List all products"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id, name, price FROM products')
            products = cursor.fetchall()
        
        result = []
        for product in products:
            result.append({
                'id': product['id'],
                'name': product['name'],
                'price': product['price']
            })
        
        return jsonify(result), 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

# Cart endpoints
@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    """Add item to cart"""
    try:
        data = request.get_json()
        
        # Validate input
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        if 'product_id' not in data or 'quantity' not in data:
            return jsonify({'error': 'Invalid request'}), 400
        
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        # Validate data types and values
        try:
            product_id = int(product_id)
            quantity = int(quantity)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid request'}), 400
        
        # Business rule: quantity must be positive
        if quantity <= 0:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Check if product exists
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
            product = cursor.fetchone()
            
            if not product:
                return jsonify({'error': 'Invalid request'}), 400
            
            # Check if item already in cart
            cursor.execute('SELECT id, quantity FROM cart_items WHERE product_id = ?', (product_id,))
            cart_item = cursor.fetchone()
            
            if cart_item:
                # Update quantity
                new_quantity = cart_item['quantity'] + quantity
                cursor.execute('UPDATE cart_items SET quantity = ? WHERE id = ?', (new_quantity, cart_item['id']))
            else:
                # Insert new cart item
                cursor.execute('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
            
            conn.commit()
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/cart', methods=['GET'])
def get_cart():
    """Get cart contents"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT c.product_id, p.name, p.price, c.quantity
                FROM cart_items c
                JOIN products p ON c.product_id = p.id
            ''')
            cart_items = cursor.fetchall()
        
        items = []
        total = 0.0
        
        for item in cart_items:
            item_dict = {
                'product_id': item['product_id'],
                'name': item['name'],
                'price': item['price'],
                'quantity': item['quantity']
            }
            items.append(item_dict)
            total += item['price'] * item['quantity']
        
        return jsonify({
            'items': items,
            'total': total
        }), 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    """Process checkout"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get cart items
            cursor.execute('''
                SELECT c.product_id, p.name, p.price, c.quantity
                FROM cart_items c
                JOIN products p ON c.product_id = p.id
            ''')
            cart_items = cursor.fetchall()
            
            # Business rule: cart must not be empty
            if not cart_items:
                return jsonify({'error': 'Invalid request'}), 400
            
            # Calculate total
            total = 0.0
            for item in cart_items:
                total += item['price'] * item['quantity']
            
            # Business rule: total must be greater than zero
            if total <= 0:
                return jsonify({'error': 'Invalid request'}), 400
            
            # Clear cart after successful checkout
            cursor.execute('DELETE FROM cart_items')
            conn.commit()
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        }), 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)