import sqlite3
import json
import os
from flask import Flask, request, jsonify

app = Flask(__name__)

DB_NAME = "db.sqlite3"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            properties TEXT NOT NULL DEFAULT '{}'
        )
    ''')
    conn.commit()
    conn.close()

init_db()

@app.route('/add', methods=['POST'])
def add_product():
    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    name = data.get('name')
    if not name or not isinstance(name, str):
        return jsonify({'error': 'Invalid input'}), 400
    
    # Collect all properties (including name and additional ones)
    properties = {}
    for key, value in data.items():
        if not isinstance(value, str):
            return jsonify({'error': 'Invalid input'}), 400
        properties[key] = value
    
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'INSERT INTO products (name, properties) VALUES (?, ?)',
            (name, json.dumps(properties))
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Product already exists'}), 400
    finally:
        conn.close()
    
    return jsonify({'message': 'Product successfully added'}), 201

@app.route('/download', methods=['GET'])
def download():
    name = request.args.get('name')
    if not name:
        return jsonify({'error': 'Name parameter is required'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
    row = cursor.fetchone()
    conn.close()
    
    if row is None:
        return jsonify({'data': ''}), 200
    
    return jsonify({'data': row['properties']}), 200

@app.route('/upload', methods=['POST'])
def upload():
    data = request.get_json()
    if not data or 'name' not in data or 'data' not in data:
        return jsonify({'error': 'Invalid upload query'}), 400
    
    name = data.get('name')
    product_data = data.get('data')
    
    if not name or not isinstance(name, str):
        return jsonify({'error': 'Invalid upload query'}), 400
    
    if not isinstance(product_data, str):
        return jsonify({'error': 'Invalid upload query'}), 400
    
    # Validate that product_data is valid JSON
    try:
        parsed = json.loads(product_data)
        if not isinstance(parsed, dict):
            return jsonify({'error': 'Invalid upload query'}), 400
    except (json.JSONDecodeError, ValueError):
        return jsonify({'error': 'Invalid upload query'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Check if product exists
    cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
    row = cursor.fetchone()
    
    if row is None:
        # Insert new product
        cursor.execute(
            'INSERT INTO products (name, properties) VALUES (?, ?)',
            (name, product_data)
        )
    else:
        # Update existing product
        cursor.execute(
            'UPDATE products SET properties = ? WHERE name = ?',
            (product_data, name)
        )
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Product updated successfully'}), 200

@app.route('/search', methods=['GET'])
def search():
    query = request.args.get('query')
    if not query:
        return jsonify({'error': 'Invalid search query'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT name, properties FROM products')
    rows = cursor.fetchall()
    conn.close()
    
    results = []
    query_lower = query.lower()
    
    for row in rows:
        name = row['name']
        properties_str = row['properties']
        
        try:
            properties = json.loads(properties_str)
        except (json.JSONDecodeError, ValueError):
            properties = {'name': name}
        
        # Search in name and all property values
        matched = False
        if query_lower in name.lower():
            matched = True
        else:
            for key, value in properties.items():
                if isinstance(value, str) and query_lower in value.lower():
                    matched = True
                    break
                elif isinstance(key, str) and query_lower in key.lower():
                    matched = True
                    break
        
        if matched:
            results.append(properties)
    
    return jsonify({'results': results}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)