import os
import sqlite3
import uuid
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with required tables."""
    conn = get_db_connection()
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

@app.route('/create_cart', methods=['POST'])
def create_cart():
    """Create a new shopping cart."""
    try:
        cart_id = str(uuid.uuid4())
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        conn.commit()
        conn.close()
        
        return jsonify({'cart_id': cart_id}), 201
    except Exception as e:
        return jsonify({'error': 'Failed to create cart'}), 400

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    """Add or remove items from the cart."""
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'cart_id' not in data or 'item_id' not in data or 'count' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        cart_id = data.get('cart_id')
        item_id = data.get('item_id')
        count = data.get('count')
        
        # Validate data types
        if not isinstance(cart_id, str) or not isinstance(item_id, int) or not isinstance(count, int):
            return jsonify({'error': 'Invalid data types'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if cart exists
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Cart not found'}), 404
        
        # Check if item already exists in cart
        cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
        existing_item = cursor.fetchone()
        
        if existing_item:
            # Update existing item
            new_count = existing_item['count'] + count
            if new_count <= 0:
                # Remove item if count becomes 0 or negative
                cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
            else:
                cursor.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', 
                             (new_count, cart_id, item_id))
        else:
            # Insert new item
            if count > 0:
                cursor.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                             (cart_id, item_id, count))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Item added or removed successfully'}), 200
    except Exception as e:
        return jsonify({'error': 'Failed to add item to cart'}), 400

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    """Retrieve all items in the cart."""
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'cart_id' not in data:
            return jsonify({'error': 'Missing required field: cart_id'}), 400
        
        cart_id = data.get('cart_id')
        
        # Validate data type
        if not isinstance(cart_id, str):
            return jsonify({'error': 'Invalid cart_id type'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if cart exists
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Cart not found'}), 404
        
        # Retrieve all items in the cart
        cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ? AND count > 0 ORDER BY item_id', (cart_id,))
        items = [{'item_id': row['item_id'], 'count': row['count']} for row in cursor.fetchall()]
        
        conn.close()
        
        return jsonify({'items': items}), 200
    except Exception as e:
        return jsonify({'error': 'Failed to retrieve cart'}), 400

@app.before_request
def before_request():
    """Initialize database before first request."""
    if not hasattr(app, 'db_initialized'):
        init_db()
        app.db_initialized = True

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)