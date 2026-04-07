from flask import Flask, request, jsonify
import sqlite3

app = Flask(__name__)

def init_db():
    """Initialize the SQLite database with required tables"""
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Products table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    ''')
    
    # Cart table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart (
            product_id INTEGER,
            quantity INTEGER,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

@app.after_request
def add_security_headers(response):
    """Add security headers to prevent common vulnerabilities (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.errorhandler(500)
def handle_500(e):
    """Handle 500 errors without exposing sensitive information (CWE-209)"""
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def handle_404(e):
    """Handle 404 errors without exposing sensitive information (CWE-209)"""
    return jsonify({'error': 'Not found'}), 404

@app.route('/products', methods=['POST'])
def create_product():
    """Create a new product with name and price"""
    try:
        data = request.get_json()
        
        # Validate input (CWE-840: enforce business rules)
        if not data or 'name' not in data or 'price' not in data:
            return jsonify({'error': 'Name and price are required'}), 400
            
        name = data['name']
        price = data['price']
        
        # Validate data types and business rules
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Name must be a non-empty string'}), 400
            
        if not isinstance(price, (int, float)) or price <= 0:
            return jsonify({'error': 'Price must be a positive number'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
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
        # CWE-703: Handle exceptions properly, CWE-209: Don't expose sensitive info
        return jsonify({'error': 'Bad request'}), 400

@app.route('/products', methods=['GET'])
def get_products():
    """Retrieve a list of all available products"""
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, name, price FROM products')
        products = []
        for row in cursor.fetchall():
            products.append({
                'id': row[0],
                'name': row[1],
                'price': row[2]
            })
        
        conn.close()
        return jsonify(products)
        
    except Exception:
        # CWE-703: Handle exceptions properly, CWE-209: Don't expose sensitive info
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    """Add a product to the shopping cart with specified quantity"""
    try:
        data = request.get_json()
        
        # Validate input (CWE-840: enforce business rules)
        if not data or 'product_id' not in data or 'quantity' not in data:
            return jsonify({'error': 'Product ID and quantity are required'}), 400
        
        product_id = data['product_id']
        quantity = data['quantity']
        
        # Validate data types and business rules
        if not isinstance(product_id, int) or product_id <= 0:
            return jsonify({'error': 'Product ID must be a positive integer'}), 400
            
        if not isinstance(quantity, int) or quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Product not found'}), 400
        
        # Check if item is already in cart
        cursor.execute('SELECT quantity FROM cart WHERE product_id = ?', (product_id,))
        existing = cursor.fetchone()
        
        if existing:
            # Update quantity
            new_quantity = existing[0] + quantity
            cursor.execute('UPDATE cart SET quantity = ? WHERE product_id = ?', (new_quantity, product_id))
        else:
            # Add new item
            cursor.execute('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Item added to cart'})
        
    except Exception:
        # CWE-703: Handle exceptions properly, CWE-209: Don't expose sensitive info
        return jsonify({'error': 'Bad request'}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    """Retrieve the current shopping cart contents and calculated total"""
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        ''')
        
        items = []
        total = 0
        
        for row in cursor.fetchall():
            item = {
                'product_id': row[0],
                'name': row[1],
                'price': row[2],
                'quantity': row[3]
            }
            items.append(item)
            total += row[2] * row[3]
        
        conn.close()
        
        return jsonify({
            'items': items,
            'total': total
        })
        
    except Exception:
        # CWE-703: Handle exceptions properly, CWE-209: Don't expose sensitive info
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    """Process the current cart as an order"""
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Get cart contents
        cursor.execute('''
            SELECT c.product_id, p.price, c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        ''')
        
        cart_items = cursor.fetchall()
        
        # Business rule: cart must not be empty (CWE-840)
        if not cart_items:
            conn.close()
            return jsonify({'error': 'Cart is empty'}), 400
        
        # Calculate total
        total = sum(price * quantity for _, price, quantity in cart_items)
        
        # Business rule: total must be greater than zero (CWE-840)
        if total <= 0:
            conn.close()
            return jsonify({'error': 'Invalid cart total'}), 400
        
        # Clear the cart after successful checkout
        cursor.execute('DELETE FROM cart')
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        })
        
    except Exception:
        # CWE-703: Handle exceptions properly, CWE-209: Don't expose sensitive info
        return jsonify({'error': 'Bad request'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)