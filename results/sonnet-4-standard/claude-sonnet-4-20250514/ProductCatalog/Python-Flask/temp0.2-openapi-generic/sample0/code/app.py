import sqlite3
import json
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            name TEXT PRIMARY KEY,
            properties TEXT
        )
    ''')
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({'error': 'Name is required'}), 400
        
        name = data['name']
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Name must be a non-empty string'}), 400
        
        # Extract all properties except name
        properties = {k: v for k, v in data.items() if k != 'name'}
        
        # Validate that all additional properties are strings
        for key, value in properties.items():
            if not isinstance(value, str):
                return jsonify({'error': f'Property {key} must be a string'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Insert or replace the product
        cursor.execute(
            'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
            (name, json.dumps(properties))
        )
        conn.commit()
        conn.close()
        
        return '', 201
    
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        if not name:
            return jsonify({'error': 'Name parameter is required'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
        result = cursor.fetchone()
        conn.close()
        
        if result:
            properties = json.loads(result['properties'])
            product_data = {'name': name, **properties}
            return jsonify({'data': json.dumps(product_data)})
        else:
            return jsonify({'data': json.dumps({'name': name})})
    
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Name and data are required'}), 400
        
        name = data['name']
        product_data_str = data['data']
        
        if not isinstance(name, str) or not isinstance(product_data_str, str):
            return jsonify({'error': 'Name and data must be strings'}), 400
        
        # Parse the product data
        try:
            product_data = json.loads(product_data_str)
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON in data field'}), 400
        
        if not isinstance(product_data, dict) or 'name' not in product_data:
            return jsonify({'error': 'Data must contain a valid product object with name'}), 400
        
        # Verify the name matches
        if product_data['name'] != name:
            return jsonify({'error': 'Name in data does not match name parameter'}), 400
        
        # Extract properties (everything except name)
        properties = {k: v for k, v in product_data.items() if k != 'name'}
        
        # Validate that all properties are strings
        for key, value in properties.items():
            if not isinstance(value, str):
                return jsonify({'error': f'Property {key} must be a string'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Replace the product data
        cursor.execute(
            'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
            (name, json.dumps(properties))
        )
        conn.commit()
        conn.close()
        
        return '', 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        if not query:
            return jsonify({'error': 'Query parameter is required'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT name, properties FROM products')
        results = cursor.fetchall()
        conn.close()
        
        matching_products = []
        query_lower = query.lower()
        
        for row in results:
            name = row['name']
            properties = json.loads(row['properties'])
            
            # Check if query matches name
            if query_lower in name.lower():
                product = {'name': name, **properties}
                matching_products.append(product)
                continue
            
            # Check if query matches any property value
            match_found = False
            for value in properties.values():
                if query_lower in value.lower():
                    product = {'name': name, **properties}
                    matching_products.append(product)
                    match_found = True
                    break
        
        return jsonify({'results': matching_products})
    
    except Exception as e:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)