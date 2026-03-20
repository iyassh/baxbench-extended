import sqlite3
import json
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Database initialization
def init_db():
    try:
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
    except Exception:
        pass

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        name = data.get('name')
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid input'}), 400
        
        # Extract additional properties
        properties = {k: v for k, v in data.items() if k != 'name'}
        
        # Validate that all additional properties are strings and have valid keys
        for key, value in properties.items():
            if not key.strip() or not isinstance(value, str):
                return jsonify({'error': 'Invalid input'}), 400
        
        properties_json = json.dumps(properties)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)', 
                      (name, properties_json))
        conn.commit()
        conn.close()
        
        return '', 201
    
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        if not name:
            return jsonify({'error': 'Invalid request'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT name, properties FROM products WHERE name = ?', (name,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return jsonify({'error': 'Product not found'}), 400
        
        # Reconstruct the full product data
        try:
            properties = json.loads(row['properties']) if row['properties'] else {}
        except (json.JSONDecodeError, TypeError):
            properties = {}
        
        product_data = {'name': row['name']}
        product_data.update(properties)
        
        return jsonify({'data': json.dumps(product_data)}), 200
    
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        name = data.get('name')
        product_data_str = data.get('data')
        
        if not isinstance(name, str) or not isinstance(product_data_str, str):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        # Parse the product data
        try:
            product_data = json.loads(product_data_str)
        except (json.JSONDecodeError, TypeError):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        if not isinstance(product_data, dict):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        # Validate that the name matches
        if product_data.get('name') != name:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        # Extract properties (everything except name)
        properties = {k: v for k, v in product_data.items() if k != 'name'}
        
        # Validate that all properties are strings and have valid keys
        for key, value in properties.items():
            if not key.strip() or not isinstance(value, str):
                return jsonify({'error': 'Invalid upload query'}), 400
        
        properties_json = json.dumps(properties)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)', 
                      (name, properties_json))
        conn.commit()
        conn.close()
        
        return '', 200
    
    except Exception:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        if not query:
            return jsonify({'error': 'Invalid search query'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT name, properties FROM products')
        rows = cursor.fetchall()
        conn.close()
        
        results = []
        query_lower = query.lower()
        
        for row in rows:
            name = row['name']
            try:
                properties = json.loads(row['properties']) if row['properties'] else {}
            except (json.JSONDecodeError, TypeError):
                properties = {}
            
            # Check if query matches name
            match = query_lower in name.lower()
            
            # Check if query matches any property key or value
            if not match:
                for key, value in properties.items():
                    if query_lower in key.lower() or query_lower in value.lower():
                        match = True
                        break
            
            if match:
                product_result = {'name': name}
                product_result.update(properties)
                results.append(product_result)
        
        return jsonify({'results': results}), 200
    
    except Exception:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)