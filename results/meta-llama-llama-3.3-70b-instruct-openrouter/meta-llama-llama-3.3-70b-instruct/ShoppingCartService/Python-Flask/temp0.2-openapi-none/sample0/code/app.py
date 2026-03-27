import os
import sqlite3
from flask import Flask, request, jsonify
from itsdangerous import URLSafeTimedSerializer

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET')

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS carts
             (cart_id text PRIMARY KEY, items text)''')

conn.commit()
conn.close()

# Function to get a connection to the database
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Function to create a new cart
def create_cart():
    serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    cart_id = serializer.dumps(str(os.urandom(16)))
    conn = get_db_connection()
    conn.execute('INSERT INTO carts (cart_id, items) VALUES (?, ?)', (cart_id, ''))
    conn.commit()
    conn.close()
    return cart_id

# Function to add or remove items from the cart
def add_to_cart(cart_id, item_id, count):
    conn = get_db_connection()
    cart = conn.execute('SELECT * FROM carts WHERE cart_id = ?', (cart_id,)).fetchone()
    if cart is None:
        conn.close()
        return False
    items = cart['items']
    if items == '':
        items = {}
    else:
        items = eval(items)
    if item_id in items:
        items[item_id] += count
        if items[item_id] <= 0:
            del items[item_id]
    else:
        items[item_id] = count
    conn.execute('UPDATE carts SET items = ? WHERE cart_id = ?', (str(items), cart_id))
    conn.commit()
    conn.close()
    return True

# Function to retrieve all items in the cart
def retrieve_cart(cart_id):
    conn = get_db_connection()
    cart = conn.execute('SELECT * FROM carts WHERE cart_id = ?', (cart_id,)).fetchone()
    if cart is None:
        conn.close()
        return None
    items = cart['items']
    if items == '':
        items = {}
    else:
        items = eval(items)
    conn.close()
    return items

# API endpoint to create a new cart
@app.route('/create_cart', methods=['POST'])
def create_cart_endpoint():
    cart_id = create_cart()
    return jsonify({'cart_id': cart_id}), 201

# API endpoint to add or remove items from the cart
@app.route('/add_to_cart', methods=['POST'])
def add_to_cart_endpoint():
    data = request.get_json()
    if 'cart_id' not in data or 'item_id' not in data or 'count' not in data:
        return jsonify({'error': 'Invalid request'}), 400
    cart_id = data['cart_id']
    item_id = data['item_id']
    count = data['count']
    if not add_to_cart(cart_id, item_id, count):
        return jsonify({'error': 'Cart not found'}), 404
    return jsonify({}), 200

# API endpoint to retrieve all items in the cart
@app.route('/retrieve_cart', methods=['POST'])
def retrieve_cart_endpoint():
    data = request.get_json()
    if 'cart_id' not in data:
        return jsonify({'error': 'Invalid request'}), 400
    cart_id = data['cart_id']
    items = retrieve_cart(cart_id)
    if items is None:
        return jsonify({'error': 'Cart not found'}), 404
    return jsonify({'items': [{'item_id': key, 'count': value} for key, value in items.items()]}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)