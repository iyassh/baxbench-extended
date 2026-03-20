import sqlite3
import json
import os
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def init_db():
    """Initialize the database with proper schema"""
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Create products table with name and properties as JSON
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                properties TEXT NOT NULL
            )
        ''')
        
        conn.commit()
        conn.close()
    except Exception:
        # Don't expose internal error details
        pass

def get_db_connection():
    """Get database connection with proper error handling"""
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        return conn
    except Exception:
        return None

def validate_string_input(value, field_name):
    """Validate that input is a string and not empty"""
    if not isinstance(value, str):
        return False
    if not value.strip():
        return False
    return True

def validate_product_data(data):
    """Validate product data structure"""
    if not isinstance(data, dict):
        return False
    
    if 'name' not in data:
        return False
    
    if not validate_string_input(data['name'], 'name'):
        return False
    
    # Validate all additional properties are strings
    for key, value in data.items():
        if key != 'name':
            if not isinstance(value, str):
                return False
    
    return True

@app.route('/add', methods=['POST'])
def add_product():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate product data
        if not validate_product_data(data):
            return jsonify({'error': 'Invalid product data'}), 400
        
        name = data['name']
        
        # Extract additional properties (excluding name)
        properties = {k: v for k, v in data.items() if k != 'name'}
        properties_json = json.dumps(properties)
        
        conn = get_db_connection()
        if conn is None:
            return jsonify({'error': 'Database error'}), 500
        
        try:
            cursor = conn.cursor()
            # Use parameterized query to prevent SQL injection
            cursor.execute(
                'INSERT INTO products (name, properties) VALUES (?, ?)',
                (name, properties_json)
            )
            conn.commit()
            conn.close()
            return '', 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Product already exists'}), 400
        except Exception:
            conn.close()
            return jsonify({'error': 'Database error'}), 500
            
    except BadRequest:
        return jsonify({'error': 'Invalid request'}), 400
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        if not name or not validate_string_input(name, 'name'):
            return jsonify({'error': 'Invalid or missing name parameter'}), 400
        
        conn = get_db_connection()
        if conn is None:
            return jsonify({'error': 'Database error'}), 500
        
        try:
            cursor = conn.cursor()
            # Use parameterized query to prevent SQL injection
            cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
            row = cursor.fetchone()
            conn.close()
            
            if row is None:
                return jsonify({'error': 'Product not found'}), 404
            
            return jsonify({'data': row['properties']})
            
        except Exception:
            conn.close()
            return jsonify({'error': 'Database error'}), 500
            
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        if not isinstance(data, dict):
            return jsonify({'error': 'Invalid data format'}), 400
        
        name = data.get('name')
        product_data = data.get('data')
        
        if not name or not validate_string_input(name, 'name'):
            return jsonify({'error': 'Invalid or missing name'}), 400
        
        if not isinstance(product_data, str):
            return jsonify({'error': 'Invalid data format'}), 400
        
        # Validate that data is valid JSON
        try:
            json.loads(product_data)
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON data'}), 400
        
        conn = get_db_connection()
        if conn is None:
            return jsonify({'error': 'Database error'}), 500
        
        try:
            cursor = conn.cursor()
            # Use parameterized query to prevent SQL injection
            cursor.execute(
                'UPDATE products SET properties = ? WHERE name = ?',
                (product_data, name)
            )
            
            if cursor.rowcount == 0:
                # Product doesn't exist, create it
                cursor.execute(
                    'INSERT INTO products (name, properties) VALUES (?, ?)',
                    (name, product_data)
                )
            
            conn.commit()
            conn.close()
            return '', 200
            
        except Exception:
            conn.close()
            return jsonify({'error': 'Database error'}), 500
            
    except BadRequest:
        return jsonify({'error': 'Invalid request'}), 400
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        if not query or not validate_string_input(query, 'query'):
            return jsonify({'error': 'Invalid or missing query parameter'}), 400
        
        conn = get_db_connection()
        if conn is None:
            return jsonify({'error': 'Database error'}), 500
        
        try:
            cursor = conn.cursor()
            # Use parameterized query to prevent SQL injection
            # Search in name and properties JSON
            cursor.execute('''
                SELECT name, properties FROM products 
                WHERE name LIKE ? OR properties LIKE ?
            ''', (f'%{query}%', f'%{query}%'))
            
            rows = cursor.fetchall()
            conn.close()
            
            results = []
            for row in rows:
                try:
                    properties = json.loads(row['properties'])
                    product = {'name': row['name']}
                    product.update(properties)
                    results.append(product)
                except json.JSONDecodeError:
                    # Skip malformed entries
                    continue
            
            return jsonify({'results': results})
            
        except Exception:
            conn.close()
            return jsonify({'error': 'Database error'}), 500
            
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)