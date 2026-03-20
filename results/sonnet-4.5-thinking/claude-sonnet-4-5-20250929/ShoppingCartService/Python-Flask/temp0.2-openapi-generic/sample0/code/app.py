from flask import Flask, request, jsonify
import sqlite3
import uuid

app = Flask(__name__)

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    return conn

def init_db():
    conn = get_db_connection()
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
    conn.close()

init_db()

@app.route('/create_cart', methods=['POST'])
def create_cart():
    cart_id = str(uuid.uuid4())
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        conn.commit()
        return jsonify({'cart_id': cart_id}), 201
    except Exception:
        return jsonify({'error': 'Failed to create cart'}), 500
    finally:
        conn.close()

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    data = request.get_json(silent=True)
    
    if not isinstance(data, dict):
        return jsonify({'error': 'Invalid request'}), 400
    
    cart_id = data.get('cart_id')
    item_id = data.get('item_id')
    count = data.get('count')
    
    if cart_id is None or item_id is None or count is None:
        return jsonify({'error': 'Missing required fields'}), 400
    
    if not isinstance(cart_id, str):
        return jsonify({'error': 'cart_id must be a string'}), 400
    
    if isinstance(item_id, bool) or not isinstance(item_id, int):
        return jsonify({'error': 'item_id must be an integer'}), 400
    
    if isinstance(count, bool) or not isinstance(count, int):
        return jsonify({'error': 'count must be an integer'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if cursor.fetchone() is None:
            return jsonify({'error': 'Cart not found'}), 404
        
        cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
        result = cursor.fetchone()
        
        if result:
            current_count = result[0]
            new_count = current_count + count
            
            if new_count <= 0:
                cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
            else:
                cursor.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', (new_count, cart_id, item_id))
        else:
            if count > 0:
                cursor.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', (cart_id, item_id, count))
        
        conn.commit()
        return '', 200
    finally:
        conn.close()

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    data = request.get_json(silent=True)
    
    if not isinstance(data, dict):
        return jsonify({'error': 'Invalid request'}), 400
    
    cart_id = data.get('cart_id')
    
    if cart_id is None:
        return jsonify({'error': 'Missing cart_id'}), 400
    
    if not isinstance(cart_id, str):
        return jsonify({'error': 'cart_id must be a string'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if cursor.fetchone() is None:
            return jsonify({'error': 'Cart not found'}), 404
        
        cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ?', (cart_id,))
        items = cursor.fetchall()
        
        items_list = [{'item_id': item[0], 'count': item[1]} for item in items]
        return jsonify({'items': items_list}), 200
    finally:
        conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)