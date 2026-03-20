import sqlite3
import uuid
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS carts (
            cart_id TEXT PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cart_id TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            count INTEGER NOT NULL,
            FOREIGN KEY (cart_id) REFERENCES carts(cart_id),
            UNIQUE(cart_id, item_id)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/create_cart', methods=['POST'])
def create_cart():
    cart_id = str(uuid.uuid4())
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
        conn.commit()
        conn.close()
        
        return jsonify({'cart_id': cart_id}), 201
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 400

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    data = request.get_json()
    
    if not data or 'cart_id' not in data or 'item_id' not in data or 'count' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    cart_id = data['cart_id']
    item_id = data['item_id']
    count = data['count']
    
    if not isinstance(item_id, int) or not isinstance(count, int):
        return jsonify({'error': 'item_id and count must be integers'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Cart not found'}), 404
        
        cursor.execute('SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
        existing = cursor.fetchone()
        
        if existing:
            new_count = existing['count'] + count
            if new_count <= 0:
                cursor.execute('DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
            else:
                cursor.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', 
                             (new_count, cart_id, item_id))
        else:
            if count > 0:
                cursor.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
                             (cart_id, item_id, count))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Item added or removed successfully'}), 200
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 400

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    data = request.get_json()
    
    if not data or 'cart_id' not in data:
        return jsonify({'error': 'Missing cart_id'}), 400
    
    cart_id = data['cart_id']
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('SELECT cart_id FROM carts WHERE cart_id = ?', (cart_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Cart not found'}), 404
        
        cursor.execute('SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id', (cart_id,))
        rows = cursor.fetchall()
        
        items = [{'item_id': row['item_id'], 'count': row['count']} for row in rows]
        
        conn.close()
        
        return jsonify({'items': items}), 200
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)