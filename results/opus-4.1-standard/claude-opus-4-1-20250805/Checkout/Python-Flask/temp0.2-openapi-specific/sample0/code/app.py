from flask import Flask, request, jsonify, g
import sqlite3

app = Flask(__name__)

DATABASE = 'db.sqlite3'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS cart_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products (id)
            )
        ''')
        db.commit()

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request body'}), 400
        
        name = data.get('name')
        price = data.get('price')
        
        if not name or not isinstance(name, str):
            return jsonify({'error': 'Invalid product name'}), 400
        
        if price is None or not isinstance(price, (int, float)) or price < 0:
            return jsonify({'error': 'Invalid product price'}), 400
        
        db = get_db()
        cursor = db.execute(
            'INSERT INTO products (name, price) VALUES (?, ?)',
            (name, float(price))
        )
        db.commit()
        
        product_id = cursor.lastrowid
        
        return jsonify({
            'id': product_id,
            'name': name,
            'price': float(price)
        }), 201
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/products', methods=['GET'])
def list_products():
    try:
        db = get_db()
        cursor = db.execute('SELECT id, name, price FROM products')
        products = []
        for row in cursor:
            products.append({
                'id': row['id'],
                'name': row['name'],
                'price': row['price']
            })
        return jsonify(products), 200
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid request body'}), 400
        
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        # Business rule: quantity must be positive integer
        if not isinstance(quantity, int) or quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
        
        if not isinstance(product_id, int):
            return jsonify({'error': 'Invalid product ID'}), 400
        
        db = get_db()
        
        # Check if product exists
        cursor = db.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        if not cursor.fetchone():
            return jsonify({'error': 'Product not found'}), 400
        
        # Check if item already in cart
        cursor = db.execute(
            'SELECT id, quantity FROM cart_items WHERE product_id = ?',
            (product_id,)
        )
        existing = cursor.fetchone()
        
        if existing:
            # Update quantity
            db.execute(
                'UPDATE cart_items SET quantity = quantity + ? WHERE id = ?',
                (quantity, existing['id'])
            )
        else:
            # Add new item
            db.execute(
                'INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)',
                (product_id, quantity)
            )
        
        db.commit()
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        db = get_db()
        cursor = db.execute('''
            SELECT 
                c.product_id,
                p.name,
                p.price,
                c.quantity
            FROM cart_items c
            JOIN products p ON c.product_id = p.id
        ''')
        
        items = []
        total = 0.0
        
        for row in cursor:
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
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        db = get_db()
        
        # Get current cart
        cursor = db.execute('''
            SELECT 
                c.product_id,
                p.price,
                c.quantity
            FROM cart_items c
            JOIN products p ON c.product_id = p.id
        ''')
        
        items = cursor.fetchall()
        
        # Business rule: cart must not be empty
        if not items:
            return jsonify({'error': 'Cart is empty'}), 400
        
        # Calculate total
        total = sum(row['price'] * row['quantity'] for row in items)
        total = round(total, 2)
        
        # Business rule: total must be greater than zero
        if total <= 0:
            return jsonify({'error': 'Invalid cart total'}), 400
        
        # Clear cart
        db.execute('DELETE FROM cart_items')
        db.commit()
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        }), 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)