from flask import Flask, request, jsonify
import sqlite3
import json

app = Flask(__name__)

DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database"""
    conn = sqlite3.connect(DB_NAME)
    try:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                properties TEXT NOT NULL
            )
        ''')
        conn.commit()
    finally:
        conn.close()

def get_db_connection():
    """Get a database connection"""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add', methods=['POST'])
def add_product():
    """Add a new product to the catalog"""
    try:
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        name = data.get('name')
        if not isinstance(name, str) or not name:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate all values are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return jsonify({'error': 'Invalid input'}), 400
        
        properties_json = json.dumps(data)
        
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO products (name, properties) VALUES (?, ?)',
                (name, properties_json)
            )
            conn.commit()
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Product already exists'}), 400
        finally:
            conn.close()
        
        return '', 201
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    """Download product data"""
    try:
        name = request.args.get('name')
        if not name:
            return jsonify({'error': 'Name parameter required'}), 400
        
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
            row = cursor.fetchone()
            
            if row is None:
                return jsonify({'error': 'Product not found'}), 400
            
            return jsonify({'data': row['properties']}), 200
        finally:
            conn.close()
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/upload', methods=['POST'])
def upload_product():
    """Upload/replace product data"""
    try:
        data = request.get_json()
        if not data or 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        name = data.get('name')
        product_data = data.get('data')
        
        if not isinstance(name, str) or not isinstance(product_data, str):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        # Parse and validate the data
        try:
            properties = json.loads(product_data)
            if not isinstance(properties, dict):
                return jsonify({'error': 'Invalid upload query'}), 400
            
            # Validate all values are strings
            for key, value in properties.items():
                if not isinstance(value, str):
                    return jsonify({'error': 'Invalid upload query'}), 400
            
            # Ensure the name in properties matches
            if 'name' not in properties or properties['name'] != name:
                return jsonify({'error': 'Invalid upload query'}), 400
        except (json.JSONDecodeError, ValueError):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        conn = get_db_connection()
        try:
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
        finally:
            conn.close()
        
        return '', 200
    except Exception:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    """Search for products"""
    try:
        query = request.args.get('query')
        if not query:
            return jsonify({'error': 'Invalid search query'}), 400
        
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT properties FROM products')
            rows = cursor.fetchall()
            
            results = []
            query_lower = query.lower()
            
            for row in rows:
                properties_json = row['properties']
                properties = json.loads(properties_json)
                
                # Search in all property values
                match = False
                for key, value in properties.items():
                    if query_lower in str(value).lower():
                        match = True
                        break
                
                if match:
                    results.append(properties)
            
            return jsonify({'results': results}), 200
        finally:
            conn.close()
    except Exception:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)