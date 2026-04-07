from flask import Flask, request, jsonify
import sqlite3

app = Flask(__name__)

# Database setup
DB_NAME = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Create products table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    ''')
    
    # Create cart table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

@app.route('/products', methods=['POST'])
def create_product():
    data = request.get_json()
    
    if not data or 'name' not in data or 'price' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    name = data['name']
    price = data['price']
    
    if not isinstance(name, str) or not isinstance(price, (int, float)):
        return jsonify({'error': 'Invalid data types'}), 400
    
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name, price))
    product_id = cursor.lastrowid
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'id': product_id,
        'name': name,
        'price': float(price)
    }), 201

@app.route('/products', methods=['GET'])
def list_products():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, name, price FROM products')
    products = cursor.fetchall()
    
    conn.close()
    
    return jsonify([{
        'id': product[0],
        'name': product[1],
        'price': product[2]
    } for product in products])

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    data = request.get_json()
    
    if not data or 'product_id' not in data or 'quantity' not in data:
        return jsonify({'error': 'Missing required fields'}), 400
    
    product_id = data['product_id']
    quantity = data['quantity']
    
    if not isinstance(product_id, int) or not isinstance(quantity, int) or quantity <= 0:
        return jsonify({'error': 'Invalid data types or quantity must be positive'}), 400
    
    # Check if product exists
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
    product = cursor.fetchone()
    
    if not product:
        conn.close()
        return jsonify({'error': 'Product not found'}), 400
    
    # Check if item already exists in cart
    cursor.execute('SELECT id, quantity FROM cart WHERE product_id = ?', (product_id,))
    existing_item = cursor.fetchone()
    
    if existing_item:
        # Update quantity
        new_quantity = existing_item[1] + quantity
        cursor.execute('UPDATE cart SET quantity = ? WHERE id = ?', (new_quantity, existing_item[0]))
    else:
        # Add new item
        cursor.execute('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Item added to cart'})

@app.route('/cart', methods=['GET'])
def get_cart():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT c.product_id, p.name, p.price, c.quantity
        FROM cart c
        JOIN products p ON c.product_id = p.id
    ''')
    cart_items = cursor.fetchall()
    
    conn.close()
    
    items = []
    total = 0
    
    for item in cart_items:
        product_id, name, price, quantity = item
        item_total = price * quantity
        total += item_total
        
        items.append({
            'product_id': product_id,
            'name': name,
            'price': price,
            'quantity': quantity
        })
    
    return jsonify({
        'items': items,
        'total': total
    })

@app.route('/checkout', methods=['POST'])
def checkout():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Get cart contents
    cursor.execute('''
        SELECT c.product_id, p.price, c.quantity
        FROM cart c
        JOIN products p ON c.product_id = p.id
    ''')
    cart_items = cursor.fetchall()
    
    if not cart_items:
        conn.close()
        return jsonify({'error': 'Cart is empty'}), 400
    
    # Calculate total
    total = sum(price * quantity for _, price, quantity in cart_items)
    
    if total <= 0:
        conn.close()
        return jsonify({'error': 'Invalid total'}), 400
    
    # Clear the cart after successful checkout
    cursor.execute('DELETE FROM cart')
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'message': 'Order confirmed',
        'total': total
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)