from flask import Flask, request, jsonify, session, make_response
import sqlite3
import os
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation
from werkzeug.exceptions import BadRequest
import secrets

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

DATABASE = 'db.sqlite3'

@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL CHECK(price > 0)
            )
        ''')
        conn.commit()

@app.before_request
def before_request():
    if 'cart' not in session:
        session['cart'] = {}

@app.after_request
def after_request(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(400)
def bad_request_handler(e):
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found_handler(e):
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error_handler(e):
    return jsonify({'error': 'Internal Server Error'}), 500

@app.errorhandler(Exception)
def general_exception_handler(e):
    app.logger.error(f"Unhandled exception: {str(e)}")
    return jsonify({'error': 'An error occurred'}), 500

@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Bad Request'}), 400
        
        name = data.get('name')
        price = data.get('price')
        
        if not name or not isinstance(name, str) or name.strip() == '':
            return jsonify({'error': 'Bad Request'}), 400
        
        if price is None or not isinstance(price, (int, float)):
            return jsonify({'error': 'Bad Request'}), 400
        
        try:
            price = float(price)
        except (ValueError, TypeError):
            return jsonify({'error': 'Bad Request'}), 400
        
        if price <= 0 or price != price:  # Check for NaN
            return jsonify({'error': 'Bad Request'}), 400
        
        with get_db() as conn:
            cursor = conn.execute(
                'INSERT INTO products (name, price) VALUES (?, ?)',
                (name.strip(), round(price, 2))
            )
            conn.commit()
            product_id = cursor.lastrowid
            
            return jsonify({
                'id': product_id,
                'name': name.strip(),
                'price': round(price, 2)
            }), 201
            
    except Exception:
        return jsonify({'error': 'Bad Request'}), 400

@app.route('/products', methods=['GET'])
def list_products():
    try:
        with get_db() as conn:
            cursor = conn.execute('SELECT id, name, price FROM products')
            products = []
            for row in cursor:
                products.append({
                    'id': row['id'],
                    'name': row['name'],
                    'price': row['price']
                })
            return jsonify(products), 200
    except Exception:
        return jsonify({'error': 'An error occurred'}), 500

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Bad Request'}), 400
        
        product_id = data.get('product_id')
        quantity = data.get('quantity')
        
        if product_id is None or not isinstance(product_id, int):
            return jsonify({'error': 'Bad Request'}), 400
        
        if quantity is None or not isinstance(quantity, int):
            return jsonify({'error': 'Bad Request'}), 400
        
        if quantity <= 0:
            return jsonify({'error': 'Bad Request'}), 400
        
        with get_db() as conn:
            cursor = conn.execute('SELECT id, name, price FROM products WHERE id = ?', (product_id,))
            product = cursor.fetchone()
            
            if not product:
                return jsonify({'error': 'Bad Request'}), 400
            
            cart = session.get('cart', {})
            product_id_str = str(product_id)
            
            if product_id_str in cart:
                cart[product_id_str]['quantity'] += quantity
            else:
                cart[product_id_str] = {
                    'product_id': product_id,
                    'name': product['name'],
                    'price': product['price'],
                    'quantity': quantity
                }
            
            session['cart'] = cart
            session.modified = True
            
            return jsonify({'message': 'Item added to cart'}), 200
            
    except Exception:
        return jsonify({'error': 'Bad Request'}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    try:
        cart = session.get('cart', {})
        items = []
        total = 0.0
        
        for item_data in cart.values():
            items.append({
                'product_id': item_data['product_id'],
                'name': item_data['name'],
                'price': item_data['price'],
                'quantity': item_data['quantity']
            })
            total += item_data['price'] * item_data['quantity']
        
        return jsonify({
            'items': items,
            'total': round(total, 2)
        }), 200
        
    except Exception:
        return jsonify({'error': 'An error occurred'}), 500

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        cart = session.get('cart', {})
        
        if not cart:
            return jsonify({'error': 'Bad Request'}), 400
        
        total = 0.0
        for item_data in cart.values():
            if item_data['quantity'] <= 0:
                return jsonify({'error': 'Bad Request'}), 400
            total += item_data['price'] * item_data['quantity']
        
        total = round(total, 2)
        
        if total <= 0:
            return jsonify({'error': 'Bad Request'}), 400
        
        session['cart'] = {}
        session.modified = True
        
        return jsonify({
            'message': 'Order confirmed',
            'total': total
        }), 200
        
    except Exception:
        return jsonify({'error': 'Bad Request'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)