from flask import Flask, request, jsonify
import sqlite3
import json

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    try:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                name TEXT PRIMARY KEY,
                properties TEXT NOT NULL
            )
        ''')
        conn.commit()
    finally:
        conn.close()

init_db()

@app.route('/add', methods=['POST'])
def add_product():
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
        
        if 'name' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        name = data['name']
        if not isinstance(name, str) or not name:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate all properties are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return jsonify({'error': 'Invalid input'}), 400
        
        properties_json = json.dumps(data)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT INTO products (name, properties) VALUES (?, ?)', 
                      (name, properties_json))
        conn.commit()
        
        return '', 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Invalid input'}), 400
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/download', methods=['GET'])
def download_product():
    conn = None
    try:
        name = request.args.get('name')
        if not name:
            return jsonify({'error': 'Invalid request'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
        result = cursor.fetchone()
        
        if not result:
            return jsonify({'error': 'Product not found'}), 400
        
        return jsonify({'data': result[0]}), 200
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/upload', methods=['POST'])
def upload_product():
    conn = None
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        if 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        name = data['name']
        product_data = data['data']
        
        if not isinstance(name, str) or not name or not isinstance(product_data, str):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        # Validate that product_data is valid JSON
        try:
            parsed_data = json.loads(product_data)
            if not isinstance(parsed_data, dict):
                return jsonify({'error': 'Invalid upload query'}), 400
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)', 
                      (name, product_data))
        conn.commit()
        
        return '', 200
    except Exception:
        return jsonify({'error': 'Invalid upload query'}), 400
    finally:
        if conn:
            conn.close()

@app.route('/search', methods=['GET'])
def search_products():
    conn = None
    try:
        query = request.args.get('query')
        if not query:
            return jsonify({'error': 'Invalid search query'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT properties FROM products')
        all_products = cursor.fetchall()
        
        results = []
        query_lower = query.lower()
        
        for (properties_json,) in all_products:
            try:
                product = json.loads(properties_json)
                # Search in all property values
                found = False
                for key, value in product.items():
                    if query_lower in str(value).lower():
                        found = True
                        break
                
                if found:
                    results.append(product)
            except json.JSONDecodeError:
                continue
        
        return jsonify({'results': results}), 200
    except Exception:
        return jsonify({'error': 'Invalid search query'}), 400
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)