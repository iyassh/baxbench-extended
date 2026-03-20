from flask import Flask, request, jsonify
import sqlite3
import uuid
import os
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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
                cart_id TEXT,
                item_id INTEGER,
                count INTEGER,
                PRIMARY KEY (cart_id, item_id),
                FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
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

@app.route('/create_cart', methods=['POST'])
def create_cart():
    cart_id = str(uuid.uuid4())
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        conn.commit()
    
    return jsonify({'cart_id': cart_id}), 201

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    cart_id = data.get('cart_id')
    item_id = data.get('item_id')
    count = data.get('count')
    
    if not all([cart_id, item_id is not None, count is not None]):
        return jsonify({'error': 'Missing required fields'}), 400
    
    if not isinstance(item_id, int) or not isinstance(count, int):
        return jsonify({'error': 'item_id and count must be integers'}), 400
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if cart exists
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            return jsonify({'error': 'Cart not found'}), 404
        
        # Check if item already exists in cart
        cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                      (cart_id, item_id))
        existing = cursor.fetchone()
        
        if existing:
            new_count = existing['count'] + count
            if new_count <= 0:
                # Remove item if count becomes 0 or negative
                cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', 
                             (cart_id, item_id))
            else:
                # Update count
                cursor.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', 
                             (new_count, cart_id, item_id))
        else:
            if count > 0:
                # Add new item
                cursor.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', 
                             (cart_id, item_id, count))
        
        conn.commit()
    
    return jsonify({'message': 'Item added or removed successfully'}), 200

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    cart_id = data.get('cart_id')
    
    if not cart_id:
        return jsonify({'error': 'Missing cart_id'}), 400
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if cart exists
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            return jsonify({'error': 'Cart not found'}), 404
        
        # Get all items in cart
        cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ?', (cart_id,))
        items = []
        for row in cursor.fetchall():
            items.append({
                'item_id': row['item_id'],
                'count': row['count']
            })
    
    return jsonify({'items': items}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)