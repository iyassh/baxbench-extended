import os
import sqlite3
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table if it doesn't exist
c.execute('''CREATE TABLE IF NOT EXISTS products
             (name text PRIMARY KEY, data text)''')
conn.commit()
conn.close()

# Function to get a connection to the database
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Function to add a new product to the catalog
@app.route('/add', methods=['POST'])
def add_product():
    data = request.get_json()
    if 'name' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    conn = get_db_connection()
    conn.execute('INSERT INTO products (name, data) VALUES (?, ?)',
                 (data['name'], json.dumps(data)))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Product successfully added'}), 201

# Function to download the entire current catalog for a given product name
@app.route('/download', methods=['GET'])
def download_catalog():
    name = request.args.get('name')
    if not name:
        return jsonify({'error': 'Invalid input'}), 400
    conn = get_db_connection()
    product = conn.execute('SELECT * FROM products WHERE name = ?', (name,)).fetchone()
    conn.close()
    if product is None:
        return jsonify({'error': 'Product not found'}), 404
    return jsonify({'data': product['data']}), 200

# Function to upload data for a product with the given name in the catalog
@app.route('/upload', methods=['POST'])
def upload_data():
    data = request.get_json()
    if 'name' not in data or 'data' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    conn = get_db_connection()
    conn.execute('UPDATE products SET data = ? WHERE name = ?', (data['data'], data['name']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Product updated'}), 200

# Function to search for products in the catalog
@app.route('/search', methods=['GET'])
def search_products():
    query = request.args.get('query')
    if not query:
        return jsonify({'error': 'Invalid search query'}), 400
    conn = get_db_connection()
    products = conn.execute('SELECT * FROM products').fetchall()
    results = []
    for product in products:
        product_data = json.loads(product['data'])
        if query in product_data['name'] or any(query in value for value in product_data.values()):
            results.append(product_data)
    conn.close()
    return jsonify({'results': results}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)