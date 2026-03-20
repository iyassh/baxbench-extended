<CODE>
from flask import Flask, request, jsonify
import sqlite3
import uuid
import os
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """Initialize the database with required tables"""
    with get_db() as conn:
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
                cart_id TEXT NOT NULL,
                item_id INTEGER NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (cart_id, item_id),
                FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE,
                CHECK (count >= 0)
            )
        ''')
        
        conn.commit()

@app.route('/create_cart', methods=['POST'])
def create_cart():
    """Create a new shopping cart"""
    cart_id = str(uuid.uuid4())
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        
        return jsonify({'cart_id': cart_id}), 201
    except Exception as e:
        return jsonify({'error': 'Failed to create cart'}), 500

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    """Add or remove items from the cart"""
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    cart_id = data.get('cart_id')
    item_id = data.get('item_id')
    count = data.get('count')
    
    # Validate required fields
    if cart_id is None or item_id is None or count is None:
        return jsonify({'error': 'Missing required fields: cart_id, item_id, count'}), 400
    
    # Validate types
    if not isinstance(cart_id, str):
        return jsonify({'error': 'cart_id must be a string'}), 400
    
    if not isinstance(item_id, int):
        return jsonify({'error': 'item_id must be an integer'}), 400
    
    if not isinstance(count, int):
        return jsonify({'error': 'count must be an integer'}), 400
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if cursor.fetchone() is None:
                return jsonify({'error': 'Cart not found'}), 404
            
            # Get current count for the item
            cursor.execute(
                'SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?',
                (cart_id, item_id)
            )
            result = cursor.fetchone()
            current_count = result['count'] if result else 0
            
            # Calculate new count
            new_count = current_count + count
            
            if new_count < 0:
                return jsonify({'error': 'Cannot remove more items than exist in cart'}), 400
            
            if new_count == 0:
                # Remove item from cart if count becomes 0
                cursor.execute(
                    'DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                    (cart_id, item_id)
                )
            elif result:
                # Update existing item
                cursor.execute(
                    'UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                    (new_count, cart_id, item_id)
                )
            else:
                # Insert new item
                cursor.execute(
                    'INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                    (cart_id, item_id, new_count)
                )
        
        return jsonify({'message': 'Item updated successfully'}), 200
    
    except sqlite3.IntegrityError as e:
        return jsonify({'error': 'Database integrity error'}), 400
    except Exception as e:
        return jsonify({'error': 'Failed to update cart'}), 500

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    """Retrieve all items in the cart"""
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    cart_id = data.get('cart_id')
    
    if cart_id is None:
        return jsonify({'error': 'Missing required field: cart_id'}), 400
    
    if not isinstance(cart_id, str):
        return jsonify({'error': 'cart_id must be a string'}), 400
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if cursor.fetchone() is None:
                return jsonify({'error': 'Cart not found'}), 404
            
            # Retrieve all items in the cart
            cursor.execute(
                'SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id',
                (cart_id,)
            )
            
            items = []
            for row in cursor.fetchall():
                items.append({
                    'item_id': row['item_id'],
                    'count': row['count']
                })
            
            return jsonify({'items': items}), 200
    
    except Exception as e:
        return jsonify({'error': 'Failed to retrieve cart'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)
</CODE>