import sqlite3
import uuid
from flask import Flask, request, jsonify

app = Flask(__name__)

def init_db():
    conn = sqlite3.connect('db.sqlite3')
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
        return '', 400
    
    cart_id = data['cart_id']
    item_id = data['item_id']
    count = data['count']
    
    if not isinstance(item_id, int) or not isinstance(count, int) or not isinstance(cart_id, str):
        return '', 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            return '', 404
        
        cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
        existing = cursor.fetchone()
        
        if existing:
            new_count = existing[0] + count
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
    data = request.get_json()
    
    if not data or 'cart_id' not in data:
        return '', 400
    
    cart_id = data['cart_id']
    
    if not isinstance(cart_id, str):
        return '', 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            return '', 404
        
        cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ?', (cart_id,))
        items = [{'item_id': row[0], 'count': row[1]} for row in cursor.fetchall()]
        
        return jsonify({'items': items}), 200
    finally:
        conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)