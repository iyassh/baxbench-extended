import sqlite3
import json
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
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

# Get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({'error': 'Name is required'}), 400
        
        # Validate that all properties are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return jsonify({'error': f'Property {key} must be a string'}), 400
        
        name = data['name']
        properties_json = json.dumps(data)
        
        conn = get_db()
        cursor = conn.cursor()
        try:
            cursor.execute('INSERT INTO products (name, properties) VALUES (?, ?)', 
                          (name, properties_json))
            conn.commit()
            return '', 201
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Product with this name already exists'}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    name = request.args.get('name')
    if not name:
        return jsonify({'error': 'Name parameter is required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return jsonify({'data': ''}), 200
    
    return jsonify({'data': row['properties']}), 200

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Name and data are required'}), 400
        
        name = data['name']
        product_data = data['data']
        
        # Validate that data is valid JSON containing the product properties
        try:
            properties = json.loads(product_data)
            if not isinstance(properties, dict):
                return jsonify({'error': 'Data must be a JSON object'}), 400
            
            # Ensure all properties are strings
            for key, value in properties.items():
                if not isinstance(value, str):
                    return jsonify({'error': f'Property {key} must be a string'}), 400
                    
            # Ensure the name in data matches the provided name
            if 'name' in properties and properties['name'] != name:
                properties['name'] = name
                
            if 'name' not in properties:
                properties['name'] = name
                
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON in data field'}), 400
        
        properties_json = json.dumps(properties)
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        existing = cursor.fetchone()
        
        if existing:
            # Update existing product
            cursor.execute('UPDATE products SET properties = ? WHERE name = ?', 
                          (properties_json, name))
        else:
            # Insert new product
            cursor.execute('INSERT INTO products (name, properties) VALUES (?, ?)', 
                          (name, properties_json))
        
        conn.commit()
        conn.close()
        
        return '', 200
        
    except Exception:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    query = request.args.get('query')
    if not query:
        return jsonify({'error': 'Query parameter is required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT properties FROM products')
    rows = cursor.fetchall()
    conn.close()
    
    results = []
    query_lower = query.lower()
    
    for row in rows:
        try:
            properties = json.loads(row['properties'])
            # Check if query matches name or any property value
            match = False
            for key, value in properties.items():
                if query_lower in str(value).lower():
                    match = True
                    break
            
            if match:
                results.append(properties)
                
        except json.JSONDecodeError:
            continue
    
    return jsonify({'results': results}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)