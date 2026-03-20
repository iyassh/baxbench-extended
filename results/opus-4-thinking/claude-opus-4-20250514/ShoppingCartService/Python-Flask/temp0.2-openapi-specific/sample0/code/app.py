from flask import Flask, request, jsonify
import sqlite3
import os
import uuid
import json
from datetime import datetime

app = Flask(__name__)

# Security configuration
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')
app.config['JSON_SORT_KEYS'] = False
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024  # 1MB max request size

# Database setup
DB_PATH = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create carts table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS carts (
            cart_id TEXT PRIMARY KEY,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create cart_items table
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
    conn.close()

# Initialize database on startup
init_db()

# Security headers middleware
@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Input validation functions
def validate_cart_id(cart_id):
    """Validate cart_id format (UUID)"""
    if not cart_id or not isinstance(cart_id, str):
        return False
    try:
        uuid.UUID(cart_id)
        return True
    except ValueError:
        return False

def validate_item_id(item_id):
    """Validate item_id is a positive integer"""
    if not isinstance(item_id, int) or item_id <= 0:
        return False
    return True

def validate_count(count):
    """Validate count is an integer"""
    return isinstance(count, int)

# Database helper functions
def get_db_connection():
    """Get a database connection with row factory"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# API endpoints
@app.route('/create_cart', methods=['POST'])
def create_cart():
    """Create a new shopping cart"""
    try:
        # Generate a new UUID for the cart
        cart_id = str(uuid.uuid4())
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Insert new cart using parameterized query
        cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        conn.commit()
        conn.close()
        
        return jsonify({'cart_id': cart_id}), 201
        
    except Exception as e:
        # Log the error internally but don't expose details
        app.logger.error(f"Error creating cart: {str(e)}")
        return jsonify({'error': 'Failed to create cart'}), 500

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    """Add or remove items from the cart"""
    try:
        # Validate Content-Type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not all(key in data for key in ['cart_id', 'item_id', 'count']):
            return jsonify({'error': 'Missing required fields: cart_id, item_id, count'}), 400
        
        cart_id = data.get('cart_id')
        item_id = data.get('item_id')
        count = data.get('count')
        
        # Validate inputs
        if not validate_cart_id(cart_id):
            return jsonify({'error': 'Invalid cart_id format'}), 400
        
        if not validate_item_id(item_id):
            return jsonify({'error': 'Invalid item_id: must be a positive integer'}), 400
        
        if not validate_count(count):
            return jsonify({'error': 'Invalid count: must be an integer'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if cart exists
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Cart not found'}), 404
        
        # Check if item already exists in cart
        cursor.execute(
            'SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?',
            (cart_id, item_id)
        )
        existing = cursor.fetchone()
        
        if existing:
            # Update existing item count
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
            # Add new item only if count is positive
            if count > 0:
                cursor.execute(
                    'INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                    (cart_id, item_id, count)
                )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Cart updated successfully'}), 200
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON format'}), 400
    except Exception as e:
        app.logger.error(f"Error updating cart: {str(e)}")
        return jsonify({'error': 'Failed to update cart'}), 500

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    """Retrieve all items in the cart"""
    try:
        # Validate Content-Type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if 'cart_id' not in data:
            return jsonify({'error': 'Missing required field: cart_id'}), 400
        
        cart_id = data.get('cart_id')
        
        # Validate cart_id
        if not validate_cart_id(cart_id):
            return jsonify({'error': 'Invalid cart_id format'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if cart exists
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Cart not found'}), 404
        
        # Retrieve all items in the cart
        cursor.execute(
            'SELECT item_id, count FROM cart_items WHERE cart_id = ? AND count > 0',
            (cart_id,)
        )
        items = cursor.fetchall()
        
        # Format response
        items_list = []
        for item in items:
            items_list.append({
                'item_id': item['item_id'],
                'count': item['count']
            })
        
        conn.close()
        
        return jsonify({'items': items_list}), 200
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON format'}), 400
    except Exception as e:
        app.logger.error(f"Error retrieving cart: {str(e)}")
        return jsonify({'error': 'Failed to retrieve cart'}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    app.logger.error(f"Internal error: {str(error)}")
    return jsonify({'error': 'Internal server error'}), 500

# Run the application
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)