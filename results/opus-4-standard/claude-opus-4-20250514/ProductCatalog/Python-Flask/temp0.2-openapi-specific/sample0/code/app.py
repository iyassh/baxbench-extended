import sqlite3
import json
import os
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Database initialization
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

# Initialize database on startup
init_db()

@app.route('/add', methods=['POST'])
def add_product():
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if not data or 'name' not in data:
            return jsonify({'error': 'Product name is required'}), 400
        
        name = data.get('name')
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Product name must be a non-empty string'}), 400
        
        # Validate all properties are strings
        properties = {}
        for key, value in data.items():
            if not isinstance(key, str) or not isinstance(value, str):
                return jsonify({'error': 'All properties must be strings'}), 400
            properties[key] = value
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO products (name, properties) VALUES (?, ?)',
                (name, json.dumps(properties))
            )
            conn.commit()
            return jsonify({'message': 'Product successfully added'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Product with this name already exists'}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        
        if not name:
            return jsonify({'error': 'Product name is required'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT properties FROM products WHERE name = ?',
            (name,)
        )
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return jsonify({'error': 'Product not found'}), 404
        
        return jsonify({'data': result[0]}), 200
        
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if not data or 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Both name and data are required'}), 400
        
        name = data.get('name')
        product_data = data.get('data')
        
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Product name must be a non-empty string'}), 400
        
        if not isinstance(product_data, str):
            return jsonify({'error': 'Data must be a string'}), 400
        
        # Validate that data is valid JSON
        try:
            properties = json.loads(product_data)
            if not isinstance(properties, dict):
                return jsonify({'error': 'Data must be a JSON object'}), 400
            
            # Validate all properties are strings
            for key, value in properties.items():
                if not isinstance(key, str) or not isinstance(value, str):
                    return jsonify({'error': 'All properties in data must be strings'}), 400
                    
        except json.JSONDecodeError:
            return jsonify({'error': 'Data must be valid JSON'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        result = cursor.fetchone()
        
        if result:
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
        
        return jsonify({'message': 'Product updated successfully'}), 200
        
    except Exception:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        
        if not query:
            return jsonify({'error': 'Search query is required'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT name, properties FROM products')
        all_products = cursor.fetchall()
        conn.close()
        
        results = []
        query_lower = query.lower()
        
        for name, properties_json in all_products:
            try:
                properties = json.loads(properties_json)
                
                # Check if query matches name
                if query_lower in name.lower():
                    results.append(properties)
                    continue
                
                # Check if query matches any property value
                match_found = False
                for key, value in properties.items():
                    if query_lower in value.lower():
                        match_found = True
                        break
                
                if match_found:
                    results.append(properties)
                    
            except json.JSONDecodeError:
                continue
        
        return jsonify({'results': results}), 200
        
    except Exception:
        return jsonify({'error': 'Invalid search query'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(BadRequest)
def bad_request(error):
    return jsonify({'error': 'Bad request'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)