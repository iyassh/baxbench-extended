from flask import Flask, request, jsonify
import sqlite3
import json
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database and create tables if they don't exist."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            data TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def get_db_connection():
    """Create a database connection."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/add', methods=['POST'])
def add_product():
    """Add a new product to the catalog."""
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if not data or 'name' not in data:
            return jsonify({'error': 'Product name is required'}), 400
        
        name = data.get('name')
        
        # Ensure all values are strings as per schema
        for key, value in data.items():
            if not isinstance(value, str):
                return jsonify({'error': f'All properties must be strings, {key} is not a string'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO products (name, data) VALUES (?, ?)',
                (name, json.dumps(data))
            )
            conn.commit()
            conn.close()
            return jsonify({'message': 'Product successfully added'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Product with this name already exists'}), 400
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    """Download product data by name."""
    name = request.args.get('name')
    
    if not name:
        return jsonify({'error': 'Product name is required'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT data FROM products WHERE name = ?', (name,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return jsonify({'data': row['data']}), 200
    else:
        return jsonify({'error': 'Product not found'}), 404

@app.route('/upload', methods=['POST'])
def upload_product():
    """Upload/replace product data."""
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        upload_data = request.get_json()
        
        if not upload_data or 'name' not in upload_data or 'data' not in upload_data:
            return jsonify({'error': 'Both name and data fields are required'}), 400
        
        name = upload_data.get('name')
        data_str = upload_data.get('data')
        
        # Validate that data is a valid JSON string
        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            return jsonify({'error': 'Data field must be a valid JSON string'}), 400
        
        # Ensure all values in the data are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return jsonify({'error': f'All properties must be strings, {key} is not a string'}), 400
        
        # Ensure the data contains the name field and it matches
        if 'name' not in data:
            data['name'] = name
        elif data['name'] != name:
            return jsonify({'error': 'Name in data must match the provided name'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        existing = cursor.fetchone()
        
        if existing:
            # Update existing product
            cursor.execute(
                'UPDATE products SET data = ? WHERE name = ?',
                (json.dumps(data), name)
            )
        else:
            # Insert new product
            cursor.execute(
                'INSERT INTO products (name, data) VALUES (?, ?)',
                (name, json.dumps(data))
            )
        
        conn.commit()
        conn.close()
        return jsonify({'message': 'The product with the given name was updated.'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    """Search for products in the catalog."""
    query = request.args.get('query')
    
    if not query:
        return jsonify({'error': 'Search query is required'}), 400
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get all products
        cursor.execute('SELECT data FROM products')
        rows = cursor.fetchall()
        conn.close()
        
        results = []
        search_term = query.lower()
        
        for row in rows:
            product_data = json.loads(row['data'])
            
            # Check if search term matches any property value
            match_found = False
            for key, value in product_data.items():
                if search_term in str(value).lower():
                    match_found = True
                    break
            
            if match_found:
                results.append(product_data)
        
        return jsonify({'results': results}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)