import sqlite3
import os
from flask import Flask, request, jsonify, session
from datetime import timedelta

app = Flask(__name__)
app.secret_key = 'checkout-app-secret-key'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)

DB_PATH = 'db.sqlite3'

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database with tables"""
    conn = get_db()
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

init_db()

@app.route('/products', methods=['POST'])
def create_product():
    """Create a new product"""
    try:
        data = request.get_json() if request.is_json else None
        
        if not data or 'name' not in data or 'price' not in data:
            return jsonify({}), 400
        
        name = data.get('name')
        price = data.get('price')
        
        if not isinstance(name, str) or not name.strip():
            return jsonify({}), 400
        
        try:
            price = float(price)
        except (ValueError, TypeError):
            return jsonify({}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name, price))
        conn.commit()
        
        product_id = cursor.lastrowid
        conn.close()
        
        return jsonify({
            'id': product_id,
            'name': name,
            'price': price
        }), 201
    
    except Exception:
        return jsonify({}), 400

@app.route('/products', methods=['GET'])
def list_products():
    """List all products"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, price FROM products')
        rows = cursor.fetchall()
        conn.close()
        
        products = [
            {
                'id': row['id'],
                'name': row['name'],
                'price': row['price']
            }
            for row in rows
        ]
        
        return jsonify(products), 200
    
    except Exception:
        return jsonify({}), 400

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    """Add item to cart"""
    try:
        data = request.get_json() if request.is_json else None
        
        if not data or 'product_id' not in data or 'quantity' not in data:
            return jsonify({}), 400
        
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        try:
            product_id = int(product_id)
        except (ValueError, TypeError):
            return jsonify({}), 400
        
        try:
            quantity = int(quantity)
        except (ValueError, TypeError):
            return jsonify({}), 400
        
        if quantity <= 0:
            return jsonify({}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({}), 400
        conn.close()
        
        if 'cart' not in session:
            session['cart'] = {}
        
        cart = session['cart']
        product_id_str = str(product_id)
        if product_id_str in cart:
            cart[product_id_str] += quantity
        else:
            cart[product_id_str] = quantity
        
        session.modified = True
        
        return jsonify({'message': 'Item added to cart'}), 200
    
    except Exception:
        return jsonify({}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    """Get cart contents"""
    try:
        if 'cart' not in session:
            session['cart'] = {}
        
        cart = session['cart']
        
        conn = get_db()
        cursor = conn.cursor()
        
        items = []
        total = 0.0
        
        for product_id_str, quantity in cart.items():
            cursor.execute('SELECT id, name, price FROM products WHERE id = ?', (int(product_id_str),))
            row = cursor.fetchone()
            
            if row:
                item_total = row['price'] * quantity
                total += item_total
                items.append({
                    'product_id': row['id'],
                    'name': row['name'],
                    'price': row['price'],
                    'quantity': quantity
                })
        
        conn.close()
        
        return jsonify({
            'items': items,
            'total': round(total, 2)
        }), 200
    
    except Exception:
        return jsonify({}), 400

@app.route('/checkout', methods=['POST'])
def checkout():
    """Process checkout"""
    try:
        if 'cart' not in session or not session['cart']:
            return jsonify({}), 400
        
        cart = session['cart']
        
        conn = get_db()
        cursor = conn.cursor()
        
        total = 0.0
        for product_id_str, quantity in cart.items():
            cursor.execute('SELECT price FROM products WHERE id = ?', (int(product_id_str),))
            row = cursor.fetchone()
            if row:
                total += row['price'] * quantity
        
        conn.close()
        
        if total <= 0:
            return jsonify({}), 400
        
        session['cart'] = {}
        session.modified = True
        
        return jsonify({
            'message': 'Order confirmed',
            'total': round(total, 2)
        }), 200
    
    except Exception:
        return jsonify({}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)