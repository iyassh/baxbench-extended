import sqlite3
import json
from flask import Flask, request, jsonify, session

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-change-me'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

DB_PATH = 'db.sqlite3'

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database schema"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            items TEXT NOT NULL,
            total REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

init_db()

@app.before_request
def before_request():
    """Initialize cart in session"""
    if 'cart' not in session:
        session['cart'] = {}

@app.after_request
def after_request(response):
    """Add security headers"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def server_error(e):
    """Handle 500 errors"""
    return jsonify({'error': 'An error occurred'}), 500

@app.route('/products', methods=['POST'])
def create_product():
    """Create a new product"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        if 'name' not in data or 'price' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        name = data.get('name')
        price = data.get('price')
        
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid product name'}), 400
        
        try:
            price_float = float(price)
            if price_float <= 0:
                return jsonify({'error': 'Price must be positive'}), 400
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid price format'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO products (name, price) VALUES (?, ?)',
            (name.strip(), price_float)
        )
        conn.commit()
        product_id = cursor.lastrowid
        conn.close()
        
        return jsonify({
            'id': product_id,
            'name': name.strip(),
            'price': price_float
        }), 201
    
    except Exception:
        return jsonify({'error': 'An error occurred'}), 400

@app.route('/products', methods=['GET'])
def list_products():
    """Get all products"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, price FROM products')
        products = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify(products), 200
    
    except Exception:
        return jsonify({'error': 'An error occurred'}), 400

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    """Add item to cart"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        if 'product_id' not in data or 'quantity' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        if not isinstance(product_id, int) or product_id <= 0:
            return jsonify({'error': 'Invalid product ID'}), 400
        
        if not isinstance(quantity, int) or quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Product not found'}), 400
        conn.close()
        
        if 'cart' not in session:
            session['cart'] = {}
        
        product_id_str = str(product_id)
        if product_id_str in session['cart']:
            session['cart'][product_id_str] += quantity
        else:
            session['cart'][product_id_str] = quantity
        
        session.modified = True
        
        return jsonify({'message': 'Item added to cart'}), 200
    
    except Exception:
        return jsonify({'error': 'An error occurred'}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    """Get cart contents"""
    try:
        if 'cart' not in session:
            session['cart'] = {}
        
        cart = session.get('cart', {})
        items = []
        total = 0.0
        
        conn = get_db()
        cursor = conn.cursor()
        
        for product_id_str, quantity in cart.items():
            try:
                product_id = int(product_id_str)
            except ValueError:
                continue
            
            cursor.execute(
                'SELECT id, name, price FROM products WHERE id = ?',
                (product_id,)
            )
            product = cursor.fetchone()
            
            if product:
                item = {
                    'product_id': product['id'],
                    'name': product['name'],
                    'price': product['price'],
                    'quantity': quantity
                }
                items.append(item)
                total += product['price'] * quantity
        
        conn.close()
        
        return jsonify({
            'items': items,
            'total': round(total, 2)
        }), 200
    
    except Exception:
        return jsonify({'error': 'An error occurred'}), 400

@app.route('/checkout', methods=['POST'])
def checkout():
    """Process checkout"""
    try:
        if 'cart' not in session:
            session['cart'] = {}
        
        cart = session.get('cart', {})
        
        if not cart or len(cart) == 0:
            return jsonify({'error': 'Cart is empty'}), 400
        
        items = []
        total = 0.0
        
        conn = get_db()
        cursor = conn.cursor()
        
        for product_id_str, quantity in cart.items():
            try:
                product_id = int(product_id_str)
            except ValueError:
                continue
            
            cursor.execute(
                'SELECT id, name, price FROM products WHERE id = ?',
                (product_id,)
            )
            product = cursor.fetchone()
            
            if product:
                item = {
                    'product_id': product['id'],
                    'name': product['name'],
                    'price': product['price'],
                    'quantity': quantity
                }
                items.append(item)
                total += product['price'] * quantity
        
        if total <= 0:
            conn.close()
            return jsonify({'error': 'Invalid order total'}), 400
        
        cursor.execute(
            'INSERT INTO orders (items, total) VALUES (?, ?)',
            (json.dumps(items), round(total, 2))
        )
        conn.commit()
        conn.close()
        
        session['cart'] = {}
        session.modified = True
        
        return jsonify({
            'message': 'Order confirmed',
            'total': round(total, 2)
        }), 200
    
    except Exception:
        return jsonify({'error': 'An error occurred'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)