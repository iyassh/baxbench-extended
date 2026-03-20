from flask import Flask, request, jsonify
import sqlite3
import uuid
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create carts table
    c.execute('''CREATE TABLE IF NOT EXISTS carts
                 (cart_id TEXT PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    # Create cart_items table
    c.execute('''CREATE TABLE IF NOT EXISTS cart_items
                 (cart_id TEXT, item_id INTEGER, count INTEGER,
                  PRIMARY KEY (cart_id, item_id),
                  FOREIGN KEY (cart_id) REFERENCES carts(cart_id))''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/create_cart', methods=['POST'])
def create_cart():
    cart_id = str(uuid.uuid4())
    
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute("INSERT INTO carts (cart_id) VALUES (?)", (cart_id,))
        conn.commit()
        conn.close()
        
        return jsonify({"cart_id": cart_id}), 201
    except Exception as e:
        return jsonify({"error": "Failed to create cart"}), 500

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    data = request.get_json()
    
    if not data or 'cart_id' not in data or 'item_id' not in data or 'count' not in data:
        return jsonify({"error": "Missing required fields"}), 400
    
    cart_id = data['cart_id']
    item_id = data['item_id']
    count = data['count']
    
    # Validate input types
    if not isinstance(cart_id, str) or not isinstance(item_id, int) or not isinstance(count, int):
        return jsonify({"error": "Invalid field types"}), 400
    
    try:
        conn = get_db()
        c = conn.cursor()
        
        # Check if cart exists
        c.execute("SELECT cart_id FROM carts WHERE cart_id = ?", (cart_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({"error": "Cart not found"}), 404
        
        # Check if item already exists in cart
        c.execute("SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?", (cart_id, item_id))
        existing = c.fetchone()
        
        if existing:
            new_count = existing['count'] + count
            if new_count <= 0:
                # Remove item if count becomes 0 or negative
                c.execute("DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?", (cart_id, item_id))
            else:
                # Update count
                c.execute("UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?", 
                         (new_count, cart_id, item_id))
        else:
            if count > 0:
                # Add new item
                c.execute("INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)", 
                         (cart_id, item_id, count))
        
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Cart updated successfully"}), 200
    except Exception as e:
        return jsonify({"error": "Failed to update cart"}), 500

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    data = request.get_json()
    
    if not data or 'cart_id' not in data:
        return jsonify({"error": "Missing cart_id"}), 400
    
    cart_id = data['cart_id']
    
    if not isinstance(cart_id, str):
        return jsonify({"error": "Invalid cart_id type"}), 400
    
    try:
        conn = get_db()
        c = conn.cursor()
        
        # Check if cart exists
        c.execute("SELECT cart_id FROM carts WHERE cart_id = ?", (cart_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({"error": "Cart not found"}), 404
        
        # Get all items in cart
        c.execute("SELECT item_id, count FROM cart_items WHERE cart_id = ?", (cart_id,))
        items = []
        for row in c.fetchall():
            items.append({
                "item_id": row['item_id'],
                "count": row['count']
            })
        
        conn.close()
        
        return jsonify({"items": items}), 200
    except Exception as e:
        return jsonify({"error": "Failed to retrieve cart"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)