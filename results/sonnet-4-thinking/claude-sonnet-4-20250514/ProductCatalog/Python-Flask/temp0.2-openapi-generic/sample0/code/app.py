import json
import sqlite3
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                name TEXT PRIMARY KEY,
                properties TEXT NOT NULL
            )
        ''')
        conn.commit()

@app.route('/add', methods=['POST'])
def add_product():
    """Add a new product to the catalog."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        if 'name' not in data:
            return jsonify({'error': 'Name field is required'}), 400
        
        name = data['name']
        
        # Validate that all properties are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return jsonify({'error': f'Property {key} must be a string'}), 400
        
        # Store the entire data as JSON
        properties_json = json.dumps(data)
        
        with sqlite3.connect(DB_NAME) as conn:
            cursor = conn.cursor()
            cursor.execute(
                'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
                (name, properties_json)
            )
            conn.commit()
        
        return '', 201
        
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    """Download product data by name."""
    name = request.args.get('name')
    
    if not name:
        return jsonify({'error': 'Name parameter is required'}), 400
    
    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
        result = cursor.fetchone()
    
    if result:
        return jsonify({'data': result[0]}), 200
    else:
        # Return empty JSON object as data if product not found
        return jsonify({'data': '{}'}), 200

@app.route('/upload', methods=['POST'])
def upload_product():
    """Upload product data."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        if 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Name and data fields are required'}), 400
        
        name = data['name']
        product_data = data['data']
        
        # Validate input types
        if not isinstance(name, str) or not isinstance(product_data, str):
            return jsonify({'error': 'Name and data must be strings'}), 400
        
        # Validate that product_data is valid JSON
        try:
            parsed_data = json.loads(product_data)
            if not isinstance(parsed_data, dict):
                return jsonify({'error': 'Product data must be a JSON object'}), 400
            if 'name' not in parsed_data:
                return jsonify({'error': 'Product data must contain a name field'}), 400
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON in data field'}), 400
        
        with sqlite3.connect(DB_NAME) as conn:
            cursor = conn.cursor()
            cursor.execute(
                'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
                (name, product_data)
            )
            conn.commit()
        
        return '', 200
        
    except Exception:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    """Search for products."""
    query = request.args.get('query')
    
    if not query:
        return jsonify({'error': 'Query parameter is required'}), 400
    
    try:
        with sqlite3.connect(DB_NAME) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT properties FROM products')
            results = cursor.fetchall()
        
        matching_products = []
        query_lower = query.lower()
        
        for (properties_json,) in results:
            try:
                product = json.loads(properties_json)
                
                # Check if query matches any property value (case-insensitive)
                match_found = any(
                    query_lower in str(value).lower() 
                    for value in product.values()
                )
                
                if match_found:
                    matching_products.append(product)
                    
            except json.JSONDecodeError:
                continue  # Skip invalid JSON entries
        
        return jsonify({'results': matching_products}), 200
        
    except Exception:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)