from flask import Flask, request, jsonify
import sqlite3
import uuid
import os
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

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
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS carts (
                cart_id TEXT PRIMARY KEY
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS cart_items (
                cart_id TEXT NOT NULL,
                item_id INTEGER NOT NULL,
                count INTEGER NOT NULL,
                PRIMARY KEY (cart_id, item_id),
                FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE
            )
        ''')
        conn.commit()

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    """Generic error handler that doesn't leak sensitive information"""
    app.logger.error(f"An error occurred: {str(e)}")
    return jsonify({"error": "An internal error occurred"}), 500

@app.route('/create_cart', methods=['POST'])
def create_cart():
    """Create a new shopping cart"""
    try:
        cart_id = str(uuid.uuid4())
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        
        return jsonify({"cart_id": cart_id}), 201
    except Exception as e:
        app.logger.error(f"Error creating cart: {str(e)}")
        return jsonify({"error": "Failed to create cart"}), 500

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    """Add or remove items from the cart"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "Invalid request body"}), 400
        
        cart_id = data.get('cart_id')
        item_id = data.get('item_id')
        count = data.get('count')
        
        # Validate required fields
        if cart_id is None or item_id is None or count is None:
            return jsonify({"error": "Missing required fields"}), 400
        
        # Validate data types
        if not isinstance(cart_id, str):
            return jsonify({"error": "cart_id must be a string"}), 400
        
        try:
            item_id = int(item_id)
            count = int(count)
        except (ValueError, TypeError):
            return jsonify({"error": "item_id and count must be integers"}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if not cursor.fetchone():
                return jsonify({"error": "Cart not found"}), 404
            
            # Get current count
            cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                         (cart_id, item_id))
            result = cursor.fetchone()
            
            if result:
                current_count = result[0]
                new_count = current_count + count
                
                if new_count <= 0:
                    # Remove item if count becomes zero or negative
                    cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                                 (cart_id, item_id))
                else:
                    # Update count
                    cursor.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                                 (new_count, cart_id, item_id))
            else:
                if count > 0:
                    # Insert new item
                    cursor.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                                 (cart_id, item_id, count))
                # If count <= 0 and item doesn't exist, do nothing
        
        return jsonify({"message": "Success"}), 200
    except Exception as e:
        app.logger.error(f"Error adding to cart: {str(e)}")
        return jsonify({"error": "Failed to update cart"}), 500

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    """Retrieve all items in the cart"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "Invalid request body"}), 400
        
        cart_id = data.get('cart_id')
        
        # Validate required fields
        if cart_id is None:
            return jsonify({"error": "Missing cart_id"}), 400
        
        # Validate data type
        if not isinstance(cart_id, str):
            return jsonify({"error": "cart_id must be a string"}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
            if not cursor.fetchone():
                return jsonify({"error": "Cart not found"}), 404
            
            # Get all items in cart
            cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ?', (cart_id,))
            rows = cursor.fetchall()
            
            items = [{"item_id": row[0], "count": row[1]} for row in rows]
        
        return jsonify({"items": items}), 200
    except Exception as e:
        app.logger.error(f"Error retrieving cart: {str(e)}")
        return jsonify({"error": "Failed to retrieve cart"}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)