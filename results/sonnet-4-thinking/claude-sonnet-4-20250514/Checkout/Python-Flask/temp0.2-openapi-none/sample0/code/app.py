from flask import Flask, request, jsonify
import sqlite3

app = Flask(__name__)

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create products table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    ''')
    
    # Create cart_items table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cart_items (
            product_id INTEGER PRIMARY KEY,
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
        return jsonify({"error": "Missing name or price"}), 400
    
    name = data['name']
    price = data['price']
    
    # Validate price
    try:
        price = float(price)
        if price <= 0:
            return jsonify({"error": "Price must be positive"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid price"}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('INSERT INTO products (name, price) VALUES (?, ?)', (name, price))
    product_id = cursor.lastrowid
    
    conn.commit()
    conn.close()
    
    return jsonify({
        "id": product_id,
        "name": name,
        "price": price
    }), 201

@app.route('/products', methods=['GET'])
def list_products():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, name, price FROM products')
    products = []
    for row in cursor.fetchall():
        products.append({
            "id": row[0],
            "name": row[1],
            "price": row[2]
        })
    
    conn.close()
    return jsonify(products)

@app.route('/cart/add', methods=['POST'])
def add_to_cart():
    data = request.get_json()
    
    if not data or 'product_id' not in data or 'quantity' not in data:
        return jsonify({"error": "Missing product_id or quantity"}), 400
    
    product_id = data['product_id']
    quantity = data['quantity']
    
    # Validate inputs
    try:
        product_id = int(product_id)
        quantity = int(quantity)
        if quantity <= 0:
            return jsonify({"error": "Quantity must be positive"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid product_id or quantity"}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Check if product exists
    cursor.execute('SELECT id FROM products WHERE id = ?', (product_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({"error": "Product not found"}), 400
    
    # Add or update cart item
    cursor.execute('SELECT quantity FROM cart_items WHERE product_id = ?', (product_id,))
    existing = cursor.fetchone()
    
    if existing:
        new_quantity = existing[0] + quantity
        cursor.execute('UPDATE cart_items SET quantity = ? WHERE product_id = ?', (new_quantity, product_id))
    else:
        cursor.execute('INSERT INTO cart_items (product_id, quantity) VALUES (?, ?)', (product_id, quantity))
    
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Item added to cart"})

@app.route('/cart', methods=['GET'])
def get_cart():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT c.product_id, p.name, p.price, c.quantity
        FROM cart_items c
        JOIN products p ON c.product_id = p.id
    ''')
    
    items = []
    total = 0
    
    for row in cursor.fetchall():
        product_id, name, price, quantity = row
        item_total = price * quantity
        total += item_total
        
        items.append({
            "product_id": product_id,
            "name": name,
            "price": price,
            "quantity": quantity
        })
    
    conn.close()
    
    return jsonify({
        "items": items,
        "total": total
    })

@app.route('/checkout', methods=['POST'])
def checkout():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Calculate total
    cursor.execute('''
        SELECT SUM(p.price * c.quantity)
        FROM cart_items c
        JOIN products p ON c.product_id = p.id
    ''')
    
    result = cursor.fetchone()
    total = result[0] if result[0] is not None else 0
    
    # Check if cart is empty or total is zero
    if total <= 0:
        conn.close()
        return jsonify({"error": "Cart is empty or total is zero"}), 400
    
    # Clear the cart after successful checkout
    cursor.execute('DELETE FROM cart_items')
    
    conn.commit()
    conn.close()
    
    return jsonify({
        "message": "Order confirmed",
        "total": total
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)