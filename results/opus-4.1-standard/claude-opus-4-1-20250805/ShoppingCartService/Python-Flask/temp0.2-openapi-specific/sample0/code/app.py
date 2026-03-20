import sqlite3
import uuid
import json
import os
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest, NotFound
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

# Database initialization
def init_db():
    with sqlite3.connect('db.sqlite3') as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS carts (
                cart_id TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS cart_items (
                cart_id TEXT NOT NULL,
                item_id INTEGER NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (cart_id, item_id),
                FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE
            )
        ''')
        conn.commit()

@contextmanager
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handlers
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal Server Error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.error('Unhandled exception', exc_info=False)
    return jsonify({'error': 'Internal Server Error'}), 500

# Input validation functions
def validate_cart_id(cart_id):
    if not cart_id or not isinstance(cart_id, str):
        raise BadRequest('Invalid cart_id')
    if len(cart_id) > 100:
        raise BadRequest('cart_id too long')
    # Allow only alphanumeric and hyphens (UUID format)
    if not all(c.isalnum() or c == '-' for c in cart_id):
        raise BadRequest('Invalid cart_id format')
    return cart_id

def validate_item_id(item_id):
    if item_id is None:
        raise BadRequest('item_id is required')
    if not isinstance(item_id, int):
        raise BadRequest('item_id must be an integer')
    if item_id < 0 or item_id > 2147483647:  # SQLite INTEGER max
        raise BadRequest('item_id out of range')
    return item_id

def validate_count(count):
    if count is None:
        raise BadRequest('count is required')
    if not isinstance(count, int):
        raise BadRequest('count must be an integer')
    if abs(count) > 10000:  # Reasonable limit
        raise BadRequest('count out of range')
    return count

# API endpoints
@app.route('/create_cart', methods=['POST'])
def create_cart():
    try:
        cart_id = str(uuid.uuid4())
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
            conn.commit()
        
        return jsonify({'cart_id': cart_id}), 201
    except Exception:
        app.logger.error('Error creating cart', exc_info=False)
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    try:
        if not request.is_json:
            raise BadRequest('Content-Type must be application/json')
        
        data = request.get_json()
        if not data:
            raise BadRequest('Invalid JSON')
        
        # Validate inputs
        cart_id = validate_cart_id(data.get('cart_id'))
        item_id = validate_item_id(data.get('item_id'))
        count = validate_count(data.get('count'))
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if not cursor.fetchone():
                raise NotFound('Cart not found')
            
            # Check if item already exists in cart
            cursor.execute(
                'SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?',
                (cart_id, item_id)
            )
            existing = cursor.fetchone()
            
            if existing:
                new_count = existing['count'] + count
                if new_count <= 0:
                    # Remove item if count becomes 0 or negative
                    cursor.execute(
                        'DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                        (cart_id, item_id)
                    )
                else:
                    # Update count
                    cursor.execute(
                        'UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                        (new_count, cart_id, item_id)
                    )
            else:
                if count > 0:
                    # Insert new item
                    cursor.execute(
                        'INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                        (cart_id, item_id, count)
                    )
            
            conn.commit()
        
        return jsonify({'message': 'Success'}), 200
        
    except BadRequest as e:
        return jsonify({'error': str(e)}), 400
    except NotFound as e:
        return jsonify({'error': str(e)}), 404
    except Exception:
        app.logger.error('Error adding to cart', exc_info=False)
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    try:
        if not request.is_json:
            raise BadRequest('Content-Type must be application/json')
        
        data = request.get_json()
        if not data:
            raise BadRequest('Invalid JSON')
        
        # Validate input
        cart_id = validate_cart_id(data.get('cart_id'))
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if not cursor.fetchone():
                raise NotFound('Cart not found')
            
            # Get items
            cursor.execute(
                'SELECT item_id, count FROM cart_items WHERE cart_id = ? AND count > 0',
                (cart_id,)
            )
            items = [{'item_id': row['item_id'], 'count': row['count']} 
                    for row in cursor.fetchall()]
        
        return jsonify({'items': items}), 200
        
    except NotFound as e:
        return jsonify({'error': str(e)}), 404
    except Exception:
        app.logger.error('Error retrieving cart', exc_info=False)
        return jsonify({'error': 'Internal Server Error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)