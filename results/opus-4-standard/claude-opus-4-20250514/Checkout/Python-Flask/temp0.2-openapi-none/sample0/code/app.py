from flask import Flask, request, jsonify
import sqlite3

app = Flask(__name__)

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create products table
    c.execute('''CREATE TABLE IF NOT EXISTS products
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL,
                  price REAL NOT NULL)''')
    
    # Create cart table
    c.execute('''CREATE TABLE IF NOT EXISTS cart
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  product_id INTEGER NOT NULL,
                  quantity INTEGER NOT NULL,
                  FOREIGN KEY (product_id) REFERENCES products (id))''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Helper function to get db connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data or 'price' not in data:
            return jsonify({'error': 'Name and price are required'}), 400
        
        name = data['name']
        price = data['price']
        
        # Validate price is a number
        try:
            price = float(price)
        except (ValueError, TypeError):
            return jsonify({'error': 'Price must be a valid number'}), 400
        
        conn = get_db()
        c = conn.cursor()
        c.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name, price))
        product_id = c.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': product_id,
            'name': name,
            'price': price
        }), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/products', methods=['GET'])
def list_products():
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT id, name, price FROM products')
    products = []
    for row in c.fetchall():
        products.append({
            'id': row['id'],
            'name': row['name'],
            'price': row['price']
        })
    conn.close()
    
    return jsonify(products), 200

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    try:
        data = request.get_json()
        if not data or 'product_id' not in data or 'quantity' not in data:
            return jsonify({'error': 'Product ID and quantity are required'}), 400
        
        product_id = data['product_id']
        quantity = data['quantity']
        
        # Validate quantity is positive integer
        try:
            quantity = int(quantity)
            if quantity <= 0:
                return jsonify({'error': 'Quantity must be a positive integer'}), 400
        except (ValueError, TypeError):
            return jsonify({'error': 'Quantity must be a positive integer'}), 400
        
        # Validate product exists
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT id FROM products WHERE id = ?', (product_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({'error': 'Product not found'}), 400
        
        # Check if product already in cart
        c.execute('SELECT id, quantity FROM cart WHERE product_id = ?', (product_id,))
        existing = c.fetchone()
        
        if existing:
            # Update quantity
            new_quantity = existing['quantity'] + quantity
            c.execute('UPDATE cart SET quantity = ? WHERE id = ?', (new_quantity, existing['id']))
        else:
            # Add new item
            c.execute('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Item added to cart'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/cart', methods=['GET'])
def get_cart():
    conn = get_db()
    c = conn.cursor()
    c.execute('''SELECT c.product_id, p.name, p.price, c.quantity 
                 FROM cart c 
                 JOIN products p ON c.product_id = p.id''')
    
    items = []
    total = 0.0
    
    for row in c.fetchall():
        item_total = row['price'] * row['quantity']
        total += item_total
        items.append({
            'product_id': row['product_id'],
            'name': row['name'],
            'price': row['price'],
            'quantity': row['quantity']
        })
    
    conn.close()
    
    return jsonify({
        'items': items,
        'total': round(total, 2)
    }), 200

@app.route('/checkout', methods=['POST'])
def checkout():
    try:
        conn = get_db()
        c = conn.cursor()
        
        # Check if cart is empty
        c.execute('SELECT COUNT(*) as count FROM cart')
        cart_count = c.fetchone()['count']
        
        if cart_count == 0:
            conn.close()
            return jsonify({'error': 'Cart is empty'}), 400
        
        # Calculate total
        c.execute('''SELECT SUM(p.price * c.quantity) as total 
                     FROM cart c 
                     JOIN products p ON c.product_id = p.id''')
        total = c.fetchone()['total']
        
        if not total or total <= 0:
            conn.close()
            return jsonify({'error': 'Invalid cart total'}), 400
        
        # Clear the cart
        c.execute('DELETE FROM cart')
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': 'Order confirmed',
            'total': round(total, 2)
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)