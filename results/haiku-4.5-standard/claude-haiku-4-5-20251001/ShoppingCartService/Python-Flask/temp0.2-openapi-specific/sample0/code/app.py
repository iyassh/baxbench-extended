import sqlite3
import uuid
import os
import json
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handler for generic exceptions
@app.errorhandler(Exception)
def handle_error(error):
    # Don't expose internal error details
    if isinstance(error, BadRequest):
        return jsonify({'error': 'Invalid request'}), 400
    return jsonify({'error': 'Internal server error'}), 500

def get_db():
    """Get database connection"""
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database schema"""
    conn = get_db()
    cursor = conn.cursor()
    
    # Create carts table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS carts (
            cart_id TEXT PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create cart_items table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cart_id TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (cart_id) REFERENCES carts(cart_id),
            UNIQUE(cart_id, item_id)
        )
    ''')
    
    conn.commit()
    conn.close()

def validate_cart_id(cart_id):
    """Validate cart_id format and existence"""
    if not isinstance(cart_id, str) or not cart_id.strip():
        return False
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT 1 FROM carts WHERE cart_id = ?', (cart_id,))
    result = cursor.fetchone()
    conn.close()
    
    return result is not None

def validate_item_id(item_id):
    """Validate item_id is a positive integer"""
    try:
        item_id_int = int(item_id)
        return item_id_int > 0
    except (ValueError, TypeError):
        return False

def validate_count(count):
    """Validate count is an integer"""
    try:
        int(count)
        return True
    except (ValueError, TypeError):
        return False

@app.route('/create_cart', methods=['POST'])
def create_cart():
    """Create a new shopping cart"""
    try:
        cart_id = str(uuid.uuid4())
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        conn.commit()
        conn.close()
        
        return jsonify({'cart_id': cart_id}), 201
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    """Add or remove items from the cart"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        cart_id = data.get('cart_id')
        item_id = data.get('item_id')
        count = data.get('count')
        
        # Validate required fields
        if cart_id is None or item_id is None or count is None:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate cart_id exists
        if not validate_cart_id(cart_id):
            return jsonify({'error': 'Cart not found'}), 404
        
        # Validate item_id
        if not validate_item_id(item_id):
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate count
        if not validate_count(count):
            return jsonify({'error': 'Invalid request'}), 400
        
        count_int = int(count)
        item_id_int = int(item_id)
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if item already exists in cart
        cursor.execute(
            'SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?',
            (cart_id, item_id_int)
        )
        result = cursor.fetchone()
        
        if result:
            # Update existing item
            new_count = result['count'] + count_int
            if new_count <= 0:
                # Remove item if count becomes 0 or negative
                cursor.execute(
                    'DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                    (cart_id, item_id_int)
                )
            else:
                cursor.execute(
                    'UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                    (new_count, cart_id, item_id_int)
                )
        else:
            # Insert new item
            if count_int > 0:
                cursor.execute(
                    'INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                    (cart_id, item_id_int, count_int)
                )
        
        conn.commit()
        conn.close()
        
        return jsonify({}), 200
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    """Retrieve all items in the cart"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        cart_id = data.get('cart_id')
        
        # Validate required fields
        if cart_id is None:
            return jsonify({'error': 'Invalid request'}), 400
        
        # Validate cart_id exists
        if not validate_cart_id(cart_id):
            return jsonify({'error': 'Cart not found'}), 404
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id',
            (cart_id,)
        )
        rows = cursor.fetchall()
        conn.close()
        
        items = [{'item_id': row['item_id'], 'count': row['count']} for row in rows]
        
        return jsonify({'items': items}), 200
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)