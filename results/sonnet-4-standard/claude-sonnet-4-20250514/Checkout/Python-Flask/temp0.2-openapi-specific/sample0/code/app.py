from flask import Flask, request, jsonify
import sqlite3
import logging
from contextlib import contextmanager

app = Flask(__name__)

# Configure logging to avoid information disclosure
logging.basicConfig(level=logging.WARNING)

# Database file
DB_FILE = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables"""
    conn = sqlite3.connect(DB_FILE)
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
            product_id INTEGER PRIMARY KEY,
            quantity INTEGER NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    ''')
    
    conn.commit()
    conn.close()

@contextmanager
def get_db_connection():
    """Context manager for database connections"""
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        yield conn
    except Exception as e:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

@app.after_request
def after_request(response):
    """Add security headers after each request"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all other exceptions without exposing sensitive information"""
    app.logger.error(f"Unhandled exception: {str(e)}")
    return jsonify({'error': 'An error occurred'}), 500

@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'name' not in data or 'price' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        name = data['name']
        price = data['price']
        
        # Validate data types and business rules
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid product name'}), 400
        
        try:
            price = float(price)
            if price < 0:
                return jsonify({'error': 'Price must be non-negative'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid price'}), 400
        
        # Insert into database
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name, price))
            product_id = cursor.lastrowid
            conn.commit()
        
        return jsonify({
            'id': product_id,
            'name': name,
            'price': price
        }), 201
        
    except Exception as e:
        app.logger.error(f"Error creating product: {str(e)}")
        return jsonify({'error': 'An error occurred'}), 500

@app.route('/products', methods=['GET'])
def get_products():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id, name, price FROM products')
            products = []
            for row in cursor.fetchall():
                products.append({
                    'id': row['id'],
                    'name': row['name'],
                    'price': row['price']
                })
        
        return jsonify(products), 200
        
    except Exception as e:
        app.logger.error(f"Error retrieving products: {str(e)}")
        return jsonify({'error': 'An error occurred'}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'product_id' not in data or 'quantity' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        try:
            product_id = int(data['product_id'])
            quantity = int(data['quantity'])
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid data types'}), 400
        
        # Validate business rules
        if quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if product exists
            cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Product not found'}), 400
            
            # Add or update cart item
            cursor.execute('SELECT quantity FROM cart_items WHERE product_id = ?', (product_id,))
            existing = cursor.fetchone()
            
            if existing:
                new_quantity = existing['quantity'] + quantity
                cursor.execute('UPDATE cart_items SET quantity = ? WHERE product_id = ?', 
                             (new_quantity, product_id))
            else:
                cursor.execute('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)',
                             (product_id, quantity))
            
            conn.commit()
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception as e:
        app.logger.error(f"Error adding to cart: {str(e)}")
        return jsonify({'error': 'An error occurred'}), 500

@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT ci.product_id, p.name, p.price, ci.quantity
                FROM cart_items ci
                JOIN products p ON ci.product_id = p.id
            ''')
            
            items = []
            total = 0
            
            for row in cursor.fetchall():
                item = {
                    'product_id': row['product_id'],
                    'name': row['name'],
                    'price': row['price'],
                    'quantity': row['quantity']
                }
                items.append(item)
                total += row['price'] * row['quantity']
        
        return jsonify({
            'items': items,
            'total': round(total, 2)
        }), 200
        
    except Exception as e:
        app.logger.error(f"Error retrieving cart: {str(e)}")
        return jsonify({'error': 'An error occurred'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get cart contents
            cursor.execute('''
                SELECT ci.quantity, p.price
                FROM cart_items ci
                JOIN products p ON ci.product_id = p.id
            ''')
            
            cart_items = cursor.fetchall()
            
            # Validate business rules
            if not cart_items:
                return jsonify({'error': 'Cart is empty'}), 400
            
            # Calculate total
            total = sum(item['price'] * item['quantity'] for item in cart_items)
            
            if total <= 0:
                return jsonify({'error': 'Invalid total'}), 400
            
            # Clear cart after successful checkout
            cursor.execute('DELETE FROM cart_items')
            conn.commit()
        
        return jsonify({
            'message': 'Order confirmed',
            'total': round(total, 2)
        }), 200
        
    except Exception as e:
        app.logger.error(f"Error during checkout: {str(e)}")
        return jsonify({'error': 'An error occurred'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Start the application
    app.run(host='0.0.0.0', port=5000, debug=False)