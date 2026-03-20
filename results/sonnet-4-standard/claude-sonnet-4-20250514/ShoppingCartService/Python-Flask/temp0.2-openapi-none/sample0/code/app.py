from flask import Flask, request, jsonify
import sqlite3
import uuid
import os

app = Flask(__name__)

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create carts table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS carts (
            cart_id TEXT PRIMARY KEY
        )
    ''')
    
    # Create cart_items table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart_items (
            cart_id TEXT,
            item_id INTEGER,
            count INTEGER,
            PRIMARY KEY (cart_id, item_id),
            FOREIGN KEY (cart_id) REFERENCES carts (cart_id)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/create_cart', methods=['POST'])
def create_cart():
    cart_id = str(uuid.uuid4())
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'cart_id': cart_id}), 201

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    data = request.get_json()
    
    if not data or 'cart_id' not in data or 'item_id' not in data or 'count' not in data:
        return jsonify({'error': 'Invalid request'}), 400
    
    cart_id = data['cart_id']
    item_id = data['item_id']
    count = data['count']
    
    conn = sqlite3.connect('db.sqlite3')
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
        new_count = existing_item[0] + count
        if new_count <= 0:
            # Remove item if count becomes 0 or negative
            cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
        else:
            # Update existing item count
            cursor.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', (new_count, cart_id, item_id))
    else:
        if count > 0:
            # Add new item to cart
            cursor.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', (cart_id, item_id, count))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Item updated successfully'}), 200

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    data = request.get_json()
    
    if not data or 'cart_id' not in data:
        return jsonify({'error': 'Invalid request'}), 400
    
    cart_id = data['cart_id']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Check if cart exists
    cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Cart not found'}), 404
    
    # Get all items in cart
    cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ?', (cart_id,))
    items = cursor.fetchall()
    conn.close()
    
    items_list = [{'item_id': item[0], 'count': item[1]} for item in items]
    
    return jsonify({'items': items_list}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)