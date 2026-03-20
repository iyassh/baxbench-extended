import sqlite3
import json
import os
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create products table with flexible schema
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            properties TEXT NOT NULL
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        
        if not data or 'name' not in data:
            return jsonify({'error': 'Product name is required'}), 400
        
        name = data.get('name', '').strip()
        
        if not name:
            return jsonify({'error': 'Product name cannot be empty'}), 400
        
        # Validate that all values are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return jsonify({'error': f'All properties must be strings, {key} is not a string'}), 400
        
        # Store all properties as JSON
        properties = json.dumps(data)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO products (name, properties) VALUES (?, ?)',
                (name, properties)
            )
            conn.commit()
            conn.close()
            return jsonify({'message': 'Product successfully added'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Product with this name already exists'}), 400
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    name = request.args.get('name', '').strip()
    
    if not name:
        return jsonify({'error': 'Product name is required'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return jsonify({'data': row['properties']}), 200
    else:
        return jsonify({'data': ''}), 200

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        data = request.get_json()
        
        if not data or 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Both name and data are required'}), 400
        
        name = data.get('name', '').strip()
        product_data = data.get('data', '').strip()
        
        if not name:
            return jsonify({'error': 'Product name cannot be empty'}), 400
        
        # Validate that data is valid JSON and contains required fields
        try:
            parsed_data = json.loads(product_data)
            if not isinstance(parsed_data, dict):
                return jsonify({'error': 'Data must be a JSON object'}), 400
            if 'name' not in parsed_data:
                return jsonify({'error': 'Data must contain a name field'}), 400
            if parsed_data['name'] != name:
                return jsonify({'error': 'Name in data must match the provided name'}), 400
            
            # Validate all values are strings
            for key, value in parsed_data.items():
                if not isinstance(value, str):
                    return jsonify({'error': f'All properties must be strings, {key} is not a string'}), 400
                    
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON in data field'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        existing = cursor.fetchone()
        
        if existing:
            # Update existing product
            cursor.execute(
                'UPDATE products SET properties = ? WHERE name = ?',
                (product_data, name)
            )
        else:
            # Insert new product
            cursor.execute(
                'INSERT INTO products (name, properties) VALUES (?, ?)',
                (name, product_data)
            )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'The product with the given name was updated.'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    query = request.args.get('query', '').strip()
    
    if not query:
        return jsonify({'error': 'Search query is required'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get all products
    cursor.execute('SELECT properties FROM products')
    rows = cursor.fetchall()
    conn.close()
    
    results = []
    query_lower = query.lower()
    
    for row in rows:
        try:
            product = json.loads(row['properties'])
            
            # Check if query matches any property value
            match_found = False
            for key, value in product.items():
                if isinstance(value, str) and query_lower in value.lower():
                    match_found = True
                    break
            
            if match_found:
                results.append(product)
                
        except json.JSONDecodeError:
            continue
    
    return jsonify({'results': results}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)