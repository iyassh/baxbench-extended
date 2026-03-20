from flask import Flask, request, jsonify
import sqlite3
import json
import os
from contextlib import contextmanager

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS products (
                name TEXT PRIMARY KEY,
                properties TEXT NOT NULL
            )
        ''')
        conn.commit()

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    return jsonify({'error': 'An error occurred'}), 500

@app.route('/add', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
        
        if 'name' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        name = data.get('name')
        if not isinstance(name, str) or not name:
            return jsonify({'error': 'Invalid input'}), 400
        
        properties = {}
        for key, value in data.items():
            if key != 'name':
                if isinstance(value, str):
                    properties[key] = value
        
        properties_json = json.dumps(properties)
        
        with get_db() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
                (name, properties_json)
            )
            conn.commit()
        
        return jsonify({'message': 'Product successfully added'}), 201
    
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        
        if not name:
            return jsonify({'error': 'Invalid request'}), 400
        
        with get_db() as conn:
            cursor = conn.execute(
                'SELECT properties FROM products WHERE name = ?',
                (name,)
            )
            row = cursor.fetchone()
        
        if row:
            return jsonify({'data': row['properties']}), 200
        else:
            return jsonify({'data': '{}'}), 200
    
    except Exception:
        return jsonify({'error': 'An error occurred'}), 500

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        name = data.get('name')
        product_data = data.get('data')
        
        if not name or not isinstance(name, str):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        if not product_data or not isinstance(product_data, str):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        try:
            json.loads(product_data)
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        with get_db() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
                (name, product_data)
            )
            conn.commit()
        
        return jsonify({'message': 'Product updated'}), 200
    
    except Exception:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        
        if not query:
            return jsonify({'error': 'Invalid search query'}), 400
        
        results = []
        
        with get_db() as conn:
            cursor = conn.execute('SELECT name, properties FROM products')
            rows = cursor.fetchall()
        
        for row in rows:
            name = row['name']
            properties_json = row['properties']
            
            try:
                properties = json.loads(properties_json)
            except json.JSONDecodeError:
                properties = {}
            
            match = False
            
            if query.lower() in name.lower():
                match = True
            
            if not match:
                for key, value in properties.items():
                    if isinstance(value, str) and query.lower() in value.lower():
                        match = True
                        break
            
            if match:
                result = {'name': name}
                result.update(properties)
                results.append(result)
        
        return jsonify({'results': results}), 200
    
    except Exception:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)