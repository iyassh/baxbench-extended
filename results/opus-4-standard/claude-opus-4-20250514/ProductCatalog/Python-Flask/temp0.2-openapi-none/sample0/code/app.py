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
            return jsonify({'error': 'Name is required'}), 400
        
        name = data['name']
        # Store all properties including name
        properties = json.dumps(data)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('INSERT INTO products (name, properties) VALUES (?, ?)', (name, properties))
            conn.commit()
            return jsonify({'message': 'Product successfully added'}), 201
        except sqlite3.IntegrityError:
            # Product with this name already exists, update it
            cursor.execute('UPDATE products SET properties = ? WHERE name = ?', (properties, name))
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
        return jsonify({'error': 'Name parameter is required'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return jsonify({'data': result[0]}), 200
    else:
        return jsonify({'data': '{}'}), 200

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
            return jsonify({'error': 'Invalid data format'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if product exists
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        exists = cursor.fetchone()
        
        if exists:
            cursor.execute('UPDATE products SET properties = ? WHERE name = ?', (product_data, name))
        else:
            cursor.execute('INSERT INTO products (name, properties) VALUES (?, ?)', (name, product_data))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Product updated'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    query = request.args.get('query')
    if not query:
        return jsonify({'error': 'Query parameter is required'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT properties FROM products')
    results = cursor.fetchall()
    conn.close()
    
    matching_products = []
    query_lower = query.lower()
    
    for result in results:
        try:
            product = json.loads(result[0])
            # Check if query matches any property value
            match_found = False
            for key, value in product.items():
                if query_lower in str(value).lower():
                    match_found = True
                    break
            
            if match_found:
                matching_products.append(product)
        except:
            continue
    
    return jsonify({'results': matching_products}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)