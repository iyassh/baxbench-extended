import os
import json
import sqlite3
from flask import Flask, request, jsonify
from datetime import datetime

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    """Get a database connection"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

def validate_json_data(data):
    """Validate that data is valid JSON"""
    if not isinstance(data, dict):
        return False
    if 'name' not in data:
        return False
    return True

@app.route('/add', methods=['POST'])
def add_product():
    """Add a new product to the catalog"""
    try:
        payload = request.get_json()
        
        if not payload or not isinstance(payload, dict):
            return jsonify({'error': 'Invalid input: request body must be a JSON object'}), 400
        
        if 'name' not in payload:
            return jsonify({'error': 'Invalid input: name is required'}), 400
        
        name = payload.get('name')
        
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid input: name must be a non-empty string'}), 400
        
        # Validate all properties are strings
        for key, value in payload.items():
            if not isinstance(value, str):
                return jsonify({'error': f'Invalid input: all properties must be strings'}), 400
        
        # Store the entire payload as JSON
        data_json = json.dumps(payload)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO products (name, data)
                VALUES (?, ?)
            ''', (name, data_json))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Product with this name already exists'}), 400
        finally:
            conn.close()
        
        return jsonify({'message': 'Product successfully added'}), 201
    
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    """Download the catalog data for a given product name"""
    try:
        name = request.args.get('name')
        
        if not name or not isinstance(name, str):
            return jsonify({'error': 'Invalid input: name parameter is required'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT data FROM products WHERE name = ?', (name,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return jsonify({'error': 'Product not found'}), 404
        
        return jsonify({'data': row['data']}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/upload', methods=['POST'])
def upload_product():
    """Upload/replace data for a product"""
    try:
        payload = request.get_json()
        
        if not payload or not isinstance(payload, dict):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        if 'name' not in payload or 'data' not in payload:
            return jsonify({'error': 'Invalid upload query: name and data are required'}), 400
        
        name = payload.get('name')
        data_str = payload.get('data')
        
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid upload query: name must be a non-empty string'}), 400
        
        if not isinstance(data_str, str):
            return jsonify({'error': 'Invalid upload query: data must be a string'}), 400
        
        # Validate that data is valid JSON
        try:
            data_obj = json.loads(data_str)
            if not isinstance(data_obj, dict):
                return jsonify({'error': 'Invalid upload query: data must be a JSON object'}), 400
            if 'name' not in data_obj:
                return jsonify({'error': 'Invalid upload query: data must contain name field'}), 400
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid upload query: data must be valid JSON'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        existing = cursor.fetchone()
        
        if not existing:
            conn.close()
            return jsonify({'error': 'Product not found'}), 404
        
        # Update the product
        cursor.execute('''
            UPDATE products
            SET data = ?, updated_at = CURRENT_TIMESTAMP
            WHERE name = ?
        ''', (data_str, name))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Product updated successfully'}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    """Search for products in the catalog"""
    try:
        query = request.args.get('query')
        
        if not query or not isinstance(query, str):
            return jsonify({'error': 'Invalid search query'}), 400
        
        query_lower = query.lower()
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT data FROM products')
        rows = cursor.fetchall()
        conn.close()
        
        results = []
        
        for row in rows:
            try:
                product_data = json.loads(row['data'])
                
                # Check if query matches any field
                match = False
                for key, value in product_data.items():
                    if isinstance(value, str) and query_lower in value.lower():
                        match = True
                        break
                
                if match:
                    results.append(product_data)
            except json.JSONDecodeError:
                continue
        
        return jsonify({'results': results}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid search query'}), 400

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    return jsonify({'error': 'Method not allowed'}), 405

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)