from flask import Flask, request, jsonify
import sqlite3
import json
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with the products table."""
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            properties TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add', methods=['POST'])
def add_product():
    """Add a new product to the catalog."""
    try:
        data = request.get_json()
        if not data or 'name' not in data:
            return '', 400
        
        # Validate that all values are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return '', 400
        
        # Extract name and other properties
        name = data['name']
        properties = {k: v for k, v in data.items() if k != 'name'}
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            # Insert product
            cursor.execute(
                'INSERT INTO products (name, properties) VALUES (?, ?)',
                (name, json.dumps(properties))
            )
            conn.commit()
            conn.close()
            return '', 201
        except sqlite3.IntegrityError:
            # Product already exists
            conn.close()
            return '', 400
        
    except Exception:
        return '', 400

@app.route('/download', methods=['GET'])
def download_product():
    """Download product data for a given product name."""
    name = request.args.get('name')
    if not name:
        return '', 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT name, properties FROM products WHERE name = ?', (name,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return jsonify({"data": ""}), 200  # Return empty data if not found
    
    # Construct product data
    product_data = {"name": row['name']}
    properties = json.loads(row['properties'])
    product_data.update(properties)
    
    # Return as string in data field
    return jsonify({"data": json.dumps(product_data)}), 200

@app.route('/upload', methods=['POST'])
def upload_product():
    """Upload data for a product to replace existing data."""
    try:
        data = request.get_json()
        if not data or 'name' not in data or 'data' not in data:
            return '', 400
        
        name = data['name']
        product_data_str = data['data']
        
        # Parse the data string
        try:
            product_data = json.loads(product_data_str)
        except:
            return '', 400
        
        # Validate all values are strings
        for key, value in product_data.items():
            if not isinstance(value, str):
                return '', 400
        
        # Extract properties (excluding name)
        properties = {k: v for k, v in product_data.items() if k != 'name'}
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Delete existing product if any
        cursor.execute('DELETE FROM products WHERE name = ?', (name,))
        
        # Insert product
        cursor.execute(
            'INSERT INTO products (name, properties) VALUES (?, ?)',
            (name, json.dumps(properties))
        )
        
        conn.commit()
        conn.close()
        
        return '', 200
        
    except Exception:
        return '', 400

@app.route('/search', methods=['GET'])
def search_products():
    """Search for products in the catalog."""
    query = request.args.get('query')
    if not query:
        return '', 400
    
    query_lower = query.lower()
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Get all products
    cursor.execute('SELECT name, properties FROM products')
    
    results = []
    for row in cursor.fetchall():
        # Check if query matches name
        if query_lower in row['name'].lower():
            product = {"name": row['name']}
            properties = json.loads(row['properties'])
            product.update(properties)
            results.append(product)
            continue
        
        # Check if query matches any property value
        properties = json.loads(row['properties'])
        match_found = False
        for prop_value in properties.values():
            if query_lower in prop_value.lower():
                match_found = True
                break
        
        if match_found:
            product = {"name": row['name']}
            product.update(properties)
            results.append(product)
    
    conn.close()
    
    return jsonify({"results": results}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)