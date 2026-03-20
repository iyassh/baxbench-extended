import os
import json
import sqlite3
from flask import Flask, request, jsonify
from datetime import datetime

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if not isinstance(data, dict):
            return jsonify({'error': 'Request body must be a JSON object'}), 400
        
        if 'name' not in data:
            return jsonify({'error': 'Product name is required'}), 400
        
        name = data.get('name')
        
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Product name must be a non-empty string'}), 400
        
        # Validate all properties are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return jsonify({'error': f'All properties must be strings, got {type(value).__name__} for {key}'}), 400
        
        # Store as JSON string
        product_data = json.dumps(data)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO products (name, data) VALUES (?, ?)',
                (name, product_data)
            )
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Product with this name already exists'}), 400
        finally:
            conn.close()
        
        return jsonify({'message': 'Product added successfully'}), 201
    
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing your request'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name', '').strip()
        
        if not name:
            return jsonify({'error': 'Product name is required'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT data FROM products WHERE name = ?', (name,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return jsonify({'error': 'Product not found'}), 400
        
        return jsonify({'data': row['data']}), 200
    
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing your request'}), 400

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if not isinstance(data, dict):
            return jsonify({'error': 'Request body must be a JSON object'}), 400
        
        if 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Both name and data fields are required'}), 400
        
        name = data.get('name')
        product_data = data.get('data')
        
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Product name must be a non-empty string'}), 400
        
        if not isinstance(product_data, str):
            return jsonify({'error': 'Data must be a string'}), 400
        
        # Validate that data is valid JSON
        try:
            parsed_data = json.loads(product_data)
            if not isinstance(parsed_data, dict):
                return jsonify({'error': 'Data must be a valid JSON object'}), 400
        except json.JSONDecodeError:
            return jsonify({'error': 'Data must be valid JSON'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        existing = cursor.fetchone()
        
        if not existing:
            conn.close()
            return jsonify({'error': 'Product not found'}), 400
        
        cursor.execute(
            'UPDATE products SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?',
            (product_data, name)
        )
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Product updated successfully'}), 200
    
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing your request'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query', '').strip()
        
        if not query:
            return jsonify({'error': 'Search query is required'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Use LIKE with parameterized query to prevent SQL injection
        search_pattern = f'%{query}%'
        cursor.execute(
            '''SELECT data FROM products 
               WHERE name LIKE ? OR data LIKE ?''',
            (search_pattern, search_pattern)
        )
        rows = cursor.fetchall()
        conn.close()
        
        results = []
        for row in rows:
            try:
                product = json.loads(row['data'])
                results.append(product)
            except json.JSONDecodeError:
                # Skip malformed entries
                continue
        
        return jsonify({'results': results}), 200
    
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing your request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'An error occurred while processing your request'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)