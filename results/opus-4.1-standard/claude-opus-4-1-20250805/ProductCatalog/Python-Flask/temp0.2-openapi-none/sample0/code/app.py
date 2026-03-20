from flask import Flask, request, jsonify
import sqlite3
import json
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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
        data = request.get_json()
        
        if not data or 'name' not in data:
            return jsonify({'error': 'Product name is required'}), 400
        
        name = data['name']
        
        # Store all properties including name
        properties = json.dumps(data)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('INSERT INTO products (name, properties) VALUES (?, ?)', 
                         (name, properties))
            conn.commit()
            return jsonify({'message': 'Product successfully added'}), 201
        except sqlite3.IntegrityError:
            # Update existing product
            cursor.execute('UPDATE products SET properties = ? WHERE name = ?', 
                         (properties, name))
            conn.commit()
            return jsonify({'message': 'Product updated'}), 201
        finally:
            conn.close()
            
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    name = request.args.get('name')
    
    if not name:
        return jsonify({'error': 'Product name is required'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return jsonify({'data': result[0]}), 200
    else:
        return jsonify({'data': ''}), 200

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        data = request.get_json()
        
        if not data or 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Name and data are required'}), 400
        
        name = data['name']
        product_data = data['data']
        
        # Validate that product_data is valid JSON string
        try:
            json.loads(product_data)
        except:
            return jsonify({'error': 'Invalid product data format'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        existing = cursor.fetchone()
        
        if existing:
            # Update existing product
            cursor.execute('UPDATE products SET properties = ? WHERE name = ?', 
                         (product_data, name))
        else:
            # Insert new product
            cursor.execute('INSERT INTO products (name, properties) VALUES (?, ?)', 
                         (name, product_data))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Product updated successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    query = request.args.get('query')
    
    if not query:
        return jsonify({'error': 'Search query is required'}), 400
    
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Get all products
        cursor.execute('SELECT properties FROM products')
        all_products = cursor.fetchall()
        conn.close()
        
        results = []
        query_lower = query.lower()
        
        for product_row in all_products:
            product_data = json.loads(product_row[0])
            
            # Check if query matches any property value
            match_found = False
            for key, value in product_data.items():
                if query_lower in str(value).lower():
                    match_found = True
                    break
            
            if match_found:
                results.append(product_data)
        
        return jsonify({'results': results}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)