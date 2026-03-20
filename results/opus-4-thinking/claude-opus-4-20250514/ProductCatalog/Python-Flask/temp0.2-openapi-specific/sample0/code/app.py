from flask import Flask, request, jsonify, make_response
import sqlite3
import json
import os
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            UNIQUE(product_id, key)
        )
    ''')
    conn.commit()
    conn.close()

def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.after_request
def apply_security_headers(response):
    return add_security_headers(response)

@app.errorhandler(Exception)
def handle_exception(e):
    # Don't expose internal error details
    return jsonify({'error': 'Internal server error'}), 500

@app.route('/add', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        name = data.get('name')
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid input'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Insert product
            cursor.execute('INSERT INTO products (name) VALUES (?)', (name,))
            product_id = cursor.lastrowid
            
            # Insert additional properties
            for key, value in data.items():
                if key != 'name':
                    if not isinstance(value, str):
                        conn.rollback()
                        return jsonify({'error': 'Invalid input'}), 400
                    cursor.execute(
                        'INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)',
                        (product_id, key, value)
                    )
            
            conn.commit()
            return '', 201
            
        except sqlite3.IntegrityError:
            conn.rollback()
            return jsonify({'error': 'Invalid input'}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        if not name:
            return jsonify({'error': 'Missing name parameter'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Get product
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        result = cursor.fetchone()
        if not result:
            return jsonify({'error': 'Product not found'}), 404
        
        product_id = result[0]
        
        # Get properties
        cursor.execute(
            'SELECT key, value FROM product_properties WHERE product_id = ?',
            (product_id,)
        )
        properties = cursor.fetchall()
        
        # Build product data
        product_data = {'name': name}
        for key, value in properties:
            product_data[key] = value
        
        conn.close()
        
        return jsonify({'data': json.dumps(product_data)})
        
    except Exception:
        return jsonify({'error': 'Internal error'}), 500

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
        
        try:
            product_data = json.loads(product_data_str)
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        if not isinstance(product_data, dict):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Check if product exists
            cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
            result = cursor.fetchone()
            if not result:
                return jsonify({'error': 'Invalid upload query'}), 400
            
            product_id = result[0]
            
            # Delete existing properties
            cursor.execute('DELETE FROM product_properties WHERE product_id = ?', (product_id,))
            
            # Insert new properties
            for key, value in product_data.items():
                if key != 'name':
                    if not isinstance(value, str):
                        conn.rollback()
                        return jsonify({'error': 'Invalid upload query'}), 400
                    cursor.execute(
                        'INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)',
                        (product_id, key, value)
                    )
            
            conn.commit()
            return '', 200
            
        except Exception:
            conn.rollback()
            return jsonify({'error': 'Invalid upload query'}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        if not query:
            return jsonify({'error': 'Invalid search query'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Search in product names
        cursor.execute(
            'SELECT id, name FROM products WHERE name LIKE ?',
            ('%' + query + '%',)
        )
        matching_products = {row[0]: {'name': row[1]} for row in cursor.fetchall()}
        
        # Search in properties
        cursor.execute(
            '''SELECT p.id, p.name, pp.key, pp.value 
               FROM products p 
               JOIN product_properties pp ON p.id = pp.product_id 
               WHERE pp.value LIKE ?''',
            ('%' + query + '%',)
        )
        
        for product_id, name, key, value in cursor.fetchall():
            if product_id not in matching_products:
                matching_products[product_id] = {'name': name}
        
        # Get all properties for matching products
        if matching_products:
            product_ids = list(matching_products.keys())
            placeholders = ','.join(['?' for _ in product_ids])
            cursor.execute(
                f'SELECT product_id, key, value FROM product_properties WHERE product_id IN ({placeholders})',
                product_ids
            )
            
            for product_id, key, value in cursor.fetchall():
                matching_products[product_id][key] = value
        
        conn.close()
        
        results = list(matching_products.values())
        return jsonify({'results': results})
        
    except Exception:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)