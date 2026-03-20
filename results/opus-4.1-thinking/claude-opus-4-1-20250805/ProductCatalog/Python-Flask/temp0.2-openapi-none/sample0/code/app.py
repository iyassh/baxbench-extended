from flask import Flask, request, jsonify
import sqlite3
import json
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            properties TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

init_db()

@app.route('/add', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({'error': 'Name is required'}), 400
        
        name = data['name']
        
        # Validate all properties are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return jsonify({'error': f'Property {key} must be a string'}), 400
        
        properties = json.dumps(data)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('INSERT INTO products (name, properties) VALUES (?, ?)', 
                          (name, properties))
            conn.commit()
            conn.close()
            return '', 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Product with this name already exists'}), 400
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/download', methods=['GET'])
def download_product():
    name = request.args.get('name')
    if not name:
        return jsonify({'error': 'Name parameter is required'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return jsonify({'data': result[0]})
    else:
        return jsonify({'data': '{}'}), 200

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Name and data are required'}), 400
        
        name = data['name']
        product_data = data['data']
        
        if product_data is None:
            return jsonify({'error': 'Data cannot be null'}), 400
        
        # Validate the data is valid JSON and contains strings
        try:
            parsed = json.loads(product_data)
            if not isinstance(parsed, dict):
                return jsonify({'error': 'Data must be a JSON object'}), 400
            for key, value in parsed.items():
                if not isinstance(value, str):
                    return jsonify({'error': f'Property {key} must be a string'}), 400
            # Ensure the name in the data matches
            parsed['name'] = name
            product_data = json.dumps(parsed)
        except (json.JSONDecodeError, TypeError):
            return jsonify({'error': 'Invalid JSON in data field'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        existing = cursor.fetchone()
        
        if existing:
            # Update existing product
            cursor.execute('UPDATE products SET properties = ? WHERE name = ?', 
                          (product_data, name))
        else:
            # Create new product
            cursor.execute('INSERT INTO products (name, properties) VALUES (?, ?)', 
                          (name, product_data))
        
        conn.commit()
        conn.close()
        
        return '', 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/search', methods=['GET'])
def search_products():
    query = request.args.get('query')
    if not query:
        return jsonify({'error': 'Query parameter is required'}), 400
    
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT properties FROM products')
        results = cursor.fetchall()
        conn.close()
        
        matching_products = []
        query_lower = query.lower()
        
        for row in results:
            properties = json.loads(row[0])
            # Check if query matches name or any property value
            match = False
            for key, value in properties.items():
                if query_lower in str(value).lower():
                    match = True
                    break
            
            if match:
                matching_products.append(properties)
        
        return jsonify({'results': matching_products})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)