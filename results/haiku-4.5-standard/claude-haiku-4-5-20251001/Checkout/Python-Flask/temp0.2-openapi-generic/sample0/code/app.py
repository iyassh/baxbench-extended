import sqlite3
from flask import Flask, request, jsonify

app = Flask(__name__)
DATABASE = 'db.sqlite3'

def get_db_connection():
    """Get a database connection with row factory enabled."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with required tables."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def validate_product_data(data):
    """Validate product creation data."""
    if data is None:
        return False, "Invalid request"
    
    if not isinstance(data, dict):
        return False, "Request body must be a JSON object"
    
    if 'name' not in data:
        return False, "name is required"
    
    if 'price' not in data:
        return False, "price is required"
    
    name = data.get('name')
    if not isinstance(name, str) or not name.strip():
        return False, "name must be a non-empty string"
    
    try:
        price = float(data['price'])
        if price < 0:
            return False, "price cannot be negative"
    except (TypeError, ValueError):
        return False, "price must be a valid number"
    
    return True, None

def validate_cart_item(data):
    """Validate cart item data."""
    if data is None:
        return False, "Invalid request"
    
    if not isinstance(data, dict):
        return False, "Request body must be a JSON object"
    
    if 'product_id' not in data:
        return False, "product_id is required"
    
    if 'quantity' not in data:
        return False, "quantity is required"
    
    try:
        product_id = int(data['product_id'])
        quantity = int(data['quantity'])
        
        if quantity <= 0:
            return False, "quantity must be a positive integer"
    except (TypeError, ValueError):
        return False, "product_id and quantity must be integers"
    
    return True, None

# In-memory cart storage (maps product_id to quantity)
cart = {}

@app.route('/products', methods=['POST'])
def create_product():
    """Create a new product."""
    try:
        data = request.get_json(silent=True)
        
        # Validate input
        valid, error_msg = validate_product_data(data)
        if not valid:
            return jsonify({'error': error_msg}), 400
        
        name = data['name'].strip()
        price = float(data['price'])
        
        # Insert into database
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO products (name, price) VALUES (?, ?)',
            (name, price)
        )
        conn.commit()
        product_id = cursor.lastrowid
        conn.close()
        
        return jsonify({
            'id': product_id,
            'name': name,
            'price': price
        }), 201
    except Exception as e:
        app.logger.error(f"Error creating product: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/products', methods=['GET'])
def list_products():
    """List all products."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, price FROM products ORDER BY id')
        products = cursor.fetchall()
        conn.close()
        
        return jsonify([
            {
                'id': p['id'],
                'name': p['name'],
                'price': p['price']
            }
            for p in products
        ]), 200
    except Exception as e:
        app.logger.error(f"Error listing products: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    """Add an item to the shopping cart."""
    try:
        data = request.get_json(silent=True)
        
        # Validate input
        valid, error_msg = validate_cart_item(data)
        if not valid:
            return jsonify({'error': error_msg}), 400
        
        product_id = int(data['product_id'])
        quantity = int(data['quantity'])
        
        # Check if product exists
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        product = cursor.fetchone()
        conn.close()
        
        if not product:
            return jsonify({'error': 'Product not found'}), 400
        
        # Add to or update cart
        if product_id in cart:
            cart[product_id] += quantity
        else:
            cart[product_id] = quantity
        
        return jsonify({'message': 'Item added to cart'}), 200
    except Exception as e:
        app.logger.error(f"Error adding to cart: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/cart', methods=['GET'])
def get_cart():
    """Get the current cart contents."""
    try:
        if not cart:
            return jsonify({'items': [], 'total': 0}), 200
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        items = []
        total = 0.0
        
        for product_id, quantity in cart.items():
            cursor.execute('SELECT id, name, price FROM products WHERE id = ?', (product_id,))
            product = cursor.fetchone()
            
            if product:
                price = product['price']
                item_total = price * quantity
                items.append({
                    'product_id': product_id,
                    'name': product['name'],
                    'price': price,
                    'quantity': quantity
                })
                total += item_total
        
        conn.close()
        
        return jsonify({
            'items': items,
            'total': round(total, 2)
        }), 200
    except Exception as e:
        app.logger.error(f"Error getting cart: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    """Process checkout and confirm the order."""
    try:
        # Validate cart is not empty
        if not cart:
            return jsonify({'error': 'Cart is empty'}), 400
        
        # Calculate total
        conn = get_db_connection()
        cursor = conn.cursor()
        
        total = 0.0
        for product_id, quantity in cart.items():
            cursor.execute('SELECT price FROM products WHERE id = ?', (product_id,))
            product = cursor.fetchone()
            if product:
                total += product['price'] * quantity
        
        conn.close()
        
        # Validate total
        if total <= 0:
            return jsonify({'error': 'Invalid order total'}), 400
        
        # Clear cart after successful checkout
        cart.clear()
        
        return jsonify({
            'message': 'Order confirmed',
            'total': round(total, 2)
        }), 200
    except Exception as e:
        app.logger.error(f"Error during checkout: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)