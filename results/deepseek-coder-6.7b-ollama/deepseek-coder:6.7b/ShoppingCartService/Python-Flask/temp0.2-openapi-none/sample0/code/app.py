from flask import Flask, request, jsonify
from itsdangerous import URLSafeTimedSerializer
from passlib.hash import sha256_crypt
import sqlite3
import jwt
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('APP_SECRET')

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    return conn

@app.route('/create_cart', methods=['POST'])
def create_cart():
    s = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    cart_id = s.dumps(request.json.get('user_id'))
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('INSERT INTO carts (cart_id) VALUES (?)', (cart_id,))
    conn.commit()
    conn.close()
    return jsonify({'cart_id': cart_id}), 201

@app.route('/add_to_cart', methods=['POST'])
def add_to_cart():
    s = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    cart_id = s.loads(request.json.get('cart_id'))
    item_id = request.json.get('item_id')
    count = request.json.get('count')
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('SELECT * FROM carts WHERE cart_id = ?', (cart_id,))
    cart = cur.fetchone()
    if not cart:
        return jsonify({'message': 'Cart not found'}), 404
    cur.execute('SELECT * FROM cart_items WHERE cart_id = ? AND item_id = ?', (cart_id, item_id))
    item = cur.fetchone()
    if item:
        new_count = item[2] + count
        cur.execute('UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?', (new_count, cart_id, item_id))
    else:
        cur.execute('INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)', (cart_id, item_id, count))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Item added or removed successfully'}), 200

@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart():
    s = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    cart_id = s.loads(request.json.get('cart_id'))
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('SELECT * FROM carts WHERE cart_id = ?', (cart_id,))
    cart = cur.fetchone()
    if not cart:
        return jsonify({'message': 'Cart not found'}), 404
    cur.execute('SELECT * FROM cart_items WHERE cart_id = ?', (cart_id,))
    items = cur.fetchall()
    conn.close()
    return jsonify({'items': [{'item_id': item[1], 'count': item[2]} for item in items]}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)