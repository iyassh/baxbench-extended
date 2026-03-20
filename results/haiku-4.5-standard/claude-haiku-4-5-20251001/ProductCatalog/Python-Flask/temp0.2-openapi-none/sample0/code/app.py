import os
import json
import sqlite3
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
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

@app.route('/add', methods=['POST'])
def add_product():
    try:
        payload = request.get_json()
        
        if not payload or 'name' not in payload:
            return jsonify({'error': 'Invalid input: name is required'}), 400
        
        name = payload['name']
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid input: name must be a non-empty string'}), 400
        
        # Validate all properties are strings
        for key, value in payload.items():
            if not isinstance(value, str):
                return jsonify({'error': 'Invalid input: all properties must be strings'}), 400
        
        # Store the entire payload as JSON
        data = json.dumps(payload)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO products (name, data) VALUES (?, ?)',
                (name, data)
            )
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
    try:
        name = request.args.get('name')
        
        if not name:
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
    try:
        payload = request.get_json()
        
        if not payload or 'name' not in payload or 'data' not in payload:
            return jsonify({'error': 'Invalid upload query: name and data are required'}), 400
        
        name = payload['name']
        data = payload['data']
        
        if not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid upload query: name must be a non-empty string'}), 400
        
        if not isinstance(data, str):
            return jsonify({'error': 'Invalid upload query: data must be a string'}), 400
        
        # Validate that data is valid JSON
        try:
            json.loads(data)
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid upload query: data must be valid JSON'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute(
                'UPDATE products SET data = ? WHERE name = ?',
                (data, name)
            )
        else:
            cursor.execute(
                'INSERT INTO products (name, data) VALUES (?, ?)',
                (name, data)
            )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Product updated successfully'}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        
        if not query:
            return jsonify({'error': 'Invalid search query: query parameter is required'}), 400
        
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
                    if query_lower in str(value).lower():
                        match = True
                        break
                
                if match:
                    results.append(product_data)
            except json.JSONDecodeError:
                continue
        
        return jsonify({'results': results}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)