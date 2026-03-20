import sqlite3
import uuid
import os
from flask import Flask, request, jsonify
from contextlib import closing

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    with closing(sqlite3.connect('db.sqlite3')) as conn:
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
                FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
            )
        ''')
        conn.commit()

# Initialize database on startup
init_db()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Error handler to prevent information leakage
@app.errorhandler(Exception)
def handle_error(error):
    app.logger.error(f"An error occurred: {str(error)}")
    return jsonify({"error": "An internal error occurred"}), 500

@app.route('/create_cart', methods=['POST'])
def create_cart():
    try:
        cart_id = str(uuid.uuid4())
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO carts (cart_id) VALUES (?)", (cart_id,))
            conn.commit()
        
        return jsonify({"cart_id": cart_id}), 201
    except Exception:
        return jsonify({"error": "Failed to create cart"}), 500

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        
        # Validate input
        if not data:
            return jsonify({"error": "Invalid request body"}), 400
        
        cart_id = data.get('cart_id')
        item_id = data.get('item_id')
        count = data.get('count')
        
        # Validate required fields
        if cart_id is None or item_id is None or count is None:
            return jsonify({"error": "Missing required fields"}), 400
        
        # Validate data types
        if not isinstance(cart_id, str) or not isinstance(item_id, int) or not isinstance(count, int):
            return jsonify({"error": "Invalid data types"}), 400
        
        # Validate cart_id format (UUID)
        try:
            uuid.UUID(cart_id)
        except ValueError:
            return jsonify({"error": "Invalid cart_id format"}), 400
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute("SELECT 1 FROM carts WHERE cart_id = ?", (cart_id,))
            if not cursor.fetchone():
                return jsonify({"error": "Cart not found"}), 404
            
            # Check if item already exists in cart
            cursor.execute("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", (cart_id, item_id))
            existing = cursor.fetchone()
            
            if existing:
                new_count = existing[0] + count
                if new_count <= 0:
                    # Remove item if count becomes 0 or negative
                    cursor.execute("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", (cart_id, item_id))
                else:
                    # Update count
                    cursor.execute("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?", 
                                 (new_count, cart_id, item_id))
            else:
                if count > 0:
                    # Add new item
                    cursor.execute("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)", 
                                 (cart_id, item_id, count))
                # If count <= 0 for new item, do nothing
            
            conn.commit()
        
        return jsonify({"message": "Success"}), 200
    except Exception:
        return jsonify({"error": "Failed to update cart"}), 500

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    try:
        data = request.get_json()
        
        # Validate input
        if not data:
            return jsonify({"error": "Invalid request body"}), 400
        
        cart_id = data.get('cart_id')
        
        # Validate required fields
        if cart_id is None:
            return jsonify({"error": "Missing cart_id"}), 400
        
        # Validate data type
        if not isinstance(cart_id, str):
            return jsonify({"error": "Invalid cart_id type"}), 400
        
        # Validate cart_id format (UUID)
        try:
            uuid.UUID(cart_id)
        except ValueError:
            return jsonify({"error": "Invalid cart_id format"}), 400
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            
            # Check if cart exists
            cursor.execute("SELECT 1 FROM carts WHERE cart_id = ?", (cart_id,))
            if not cursor.fetchone():
                return jsonify({"error": "Cart not found"}), 404
            
            # Retrieve items
            cursor.execute("SELECT item_id, count FROM cart_items WHERE cart_id = ?", (cart_id,))
            items = []
            for row in cursor.fetchall():
                items.append({
                    "item_id": row[0],
                    "count": row[1]
                })
        
        return jsonify({"items": items}), 200
    except Exception:
        return jsonify({"error": "Failed to retrieve cart"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)