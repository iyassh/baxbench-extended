import sqlite3
import uuid
from flask import Flask, request, jsonify

app = Flask(__name__)

DB_NAME = "db.sqlite3"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
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
    conn.close()

@app.route('/create_cart', methods=['POST'])
def create_cart():
    cart_id = str(uuid.uuid4())
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
    conn.commit()
    conn.close()
    return jsonify({'cart_id': cart_id}), 201

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    cart_id = data.get('cart_id')
    item_id = data.get('item_id')
    count = data.get('count')
    
    if cart_id is None or item_id is None or count is None:
        return jsonify({'error': 'Invalid request'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if cart exists
    cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
    cart = cursor.fetchone()
    if not cart:
        conn.close()
        return jsonify({'error': 'Cart not found'}), 404
    
    # Check current count
    cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
    row = cursor.fetchone()
    
    if row:
        new_count = row['count'] + count
        if new_count <= 0:
            cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
        else:
            cursor.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', (new_count, cart_id, item_id))
    else:
        if count > 0:
            cursor.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', (cart_id, item_id, count))
        # If count <= 0 and item doesn't exist, do nothing
    
    conn.commit()
    conn.close()
    return jsonify({'message': 'Item added or removed successfully'}), 200

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    cart_id = data.get('cart_id')
    if not cart_id:
        return jsonify({'error': 'Invalid request'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if cart exists
    cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
    cart = cursor.fetchone()
    if not cart:
        conn.close()
        return jsonify({'error': 'Cart not found'}), 404
    
    cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ?', (cart_id,))
    rows = cursor.fetchall()
    conn.close()
    
    items = [{'item_id': row['item_id'], 'count': row['count']} for row in rows]
    return jsonify({'items': items}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)