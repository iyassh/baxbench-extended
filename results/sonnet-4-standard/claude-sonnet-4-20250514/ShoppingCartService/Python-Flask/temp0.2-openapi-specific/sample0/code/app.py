import sqlite3
import json
import uuid
import os
from flask import Flask, request, jsonify
from contextlib import contextmanager
import logging

app = Flask(__name__)

# Configure logging to avoid sensitive information leakage
logging.basicConfig(level=logging.WARNING)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Database initialization
def init_db():
    try:
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS carts (
                    cart_id TEXT PRIMARY KEY
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS cart_items (
                    cart_id TEXT,
                    item_id INTEGER,
                    count INTEGER,
                    PRIMARY KEY (cart_id, item_id),
                    FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
                )
            ''')
            conn.commit()
    except sqlite3.Error:
        # Don't expose database errors
        pass

@contextmanager
def get_db_connection():
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        yield conn
    except sqlite3.Error:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

def validate_json_input(data, required_fields):
    if not isinstance(data, dict):
        return False
    for field in required_fields:
        if field not in data:
            return False
    return True

def validate_cart_id(cart_id):
    if not isinstance(cart_id, str) or len(cart_id) == 0 or len(cart_id) > 100:
        return False
    # Basic UUID format validation
    try:
        uuid.UUID(cart_id)
        return True
    except ValueError:
        return False

def validate_item_id(item_id):
    return isinstance(item_id, int) and item_id > 0

def validate_count(count):
    return isinstance(count, int) and -1000000 <= count <= 1000000

@app.route('/create_cart', methods=['POST'])
def create_cart():
    try:
        cart_id = str(uuid.uuid4())
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
            conn.commit()
        
        return jsonify({'cart_id': cart_id}), 201
    
    except sqlite3.Error:
        return jsonify({'error': 'Internal server error'}), 500
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate required fields
        if not validate_json_input(data, ['cart_id', 'item_id', 'count']):
            return jsonify({'error': 'Missing required fields'}), 400
        
        cart_id = data['cart_id']
        item_id = data['item_id']
        count = data['count']
        
        # Validate input types and ranges
        if not validate_cart_id(cart_id):
            return jsonify({'error': 'Invalid cart_id'}), 400
        
        if not validate_item_id(item_id):
            return jsonify({'error': 'Invalid item_id'}), 400
        
        if not validate_count(count):
            return jsonify({'error': 'Invalid count'}), 400
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if cursor.fetchone() is None:
                return jsonify({'error': 'Cart not found'}), 404
            
            # Get current count for the item
            cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                         (cart_id, item_id))
            result = cursor.fetchone()
            current_count = result['count'] if result else 0
            
            new_count = current_count + count
            
            if new_count <= 0:
                # Remove item if count becomes zero or negative
                cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                             (cart_id, item_id))
            else:
                # Insert or update item
                cursor.execute('''
                    INSERT OR REPLACE INTO cart_items (cart_id, item_id, count) 
                    VALUES (?, ?, ?)
                ''', (cart_id, item_id, new_count))
            
            conn.commit()
        
        return jsonify({'message': 'Success'}), 200
    
    except sqlite3.Error:
        return jsonify({'error': 'Internal server error'}), 500
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate required fields
        if not validate_json_input(data, ['cart_id']):
            return jsonify({'error': 'Missing required fields'}), 400
        
        cart_id = data['cart_id']
        
        # Validate input
        if not validate_cart_id(cart_id):
            return jsonify({'error': 'Invalid cart_id'}), 400
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if cursor.fetchone() is None:
                return jsonify({'error': 'Cart not found'}), 404
            
            # Get all items in the cart
            cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ?', (cart_id,))
            items = []
            for row in cursor.fetchall():
                items.append({
                    'item_id': row['item_id'],
                    'count': row['count']
                })
        
        return jsonify({'items': items}), 200
    
    except sqlite3.Error:
        return jsonify({'error': 'Internal server error'}), 500
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