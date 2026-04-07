from flask import Flask, request, jsonify, session
import sqlite3
import os
from datetime import timedelta

app = Flask(__name__)
app.secret_key = os.urandom(24)
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)

DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def get_session_id():
    """Get or create a session ID."""
    if 'cart_id' not in session:
        session['cart_id'] = os.urandom(16).hex()
        session.permanent = True
    return session['cart_id']

@app.route('/products', methods=['POST'])
def create_product():
    """Create a new product."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        name = data.get('name')
        price = data.get('price')
        
        if not name or price is None:
            return jsonify({'error': 'Name and price are required'}), 400
        
        if not isinstance(name, str) or len(name.strip()) == 0:
            return jsonify({'error': 'Name must be a non-empty string'}), 400
        
        name = name.strip()
        
        try:
            price = float(price)
            if price < 0:
                return jsonify({'error': 'Price must be non-negative'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Price must be a valid number'}), 400
        
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
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/products', methods=['GET'])
def list_products():
    """List all products."""
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
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    """Add an item to the cart."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        if product_id is None or quantity is None:
            return jsonify({'error': 'product_id and quantity are required'}), 400
        
        try:
            product_id = int(product_id)
            quantity = int(quantity)
        except (ValueError, TypeError):
            return jsonify({'error': 'product_id and quantity must be integers'}), 400
        
        if quantity <= 0:
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        product = cursor.fetchone()
        
        if not product:
            conn.close()
            return jsonify({'error': 'Product not found'}), 400
        
        session_id = get_session_id()
        
        cursor.execute('SELECT id, quantity FROM cart_items WHERE session_id = ? AND product_id = ?',
                      (session_id, product_id))
        existing_item = cursor.fetchone()
        
        if existing_item:
            new_quantity = existing_item['quantity'] + quantity
            cursor.execute('UPDATE cart_items SET quantity = ? WHERE id = ?',
                         (new_quantity, existing_item['id']))
        else:
            cursor.execute('INSERT INTO cart_items (session_id, product_id, quantity) VALUES (?, ?, ?)',
                         (session_id, product_id, quantity))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Item added to cart'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/cart', methods=['GET'])
def get_cart():
    """Get cart contents."""
    try:
        session_id = get_session_id()
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart_items c
            JOIN products p ON c.product_id = p.id
            WHERE c.session_id = ?
        ''', (session_id,))
        
        items = []
        total = 0.0
        
        for row in cursor.fetchall():
            item = {
                'product_id': row['product_id'],
                'name': row['name'],
                'price': row['price'],
                'quantity': row['quantity']
            }
            items.append(item)
            total += row['price'] * row['quantity']
        
        conn.close()
        
        return jsonify({
            'items': items,
            'total': total
        }), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    """Process checkout."""
    try:
        session_id = get_session_id()
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT c.product_id, p.name, p.price, c.quantity
            FROM cart_items c
            JOIN products p ON c.product_id = p.id
            WHERE c.session_id = ?
        ''', (session_id,))
        
        items = cursor.fetchall()
        
        if not items:
            conn.close()
            return jsonify({'error': 'Cart is empty'}), 400
        
        total = 0.0
        for row in items:
            total += row['price'] * row['quantity']
        
        if total <= 0:
            conn.close()
            return jsonify({'error': 'Total must be greater than zero'}), 400
        
        cursor.execute('DELETE FROM cart_items WHERE session_id = ?', (session_id,))
        conn.commit()
        conn.close()
        
        session.pop('cart_id', None)
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        }), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)