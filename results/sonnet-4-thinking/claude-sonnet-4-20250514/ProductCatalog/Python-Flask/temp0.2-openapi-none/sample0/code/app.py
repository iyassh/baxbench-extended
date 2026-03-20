import sqlite3
import json
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret')

def init_db():
    conn = sqlite3.connect('db.sqlite3')
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
        data = request.get_json()
        if not data or 'name' not in data:
            return '', 400
        
        # Validate that all properties are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return '', 400
        
        name = data['name']
        product_data = json.dumps(data)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        try:
            cursor.execute('INSERT INTO products (name, data) VALUES (?, ?)', (name, product_data))
            conn.commit()
            return '', 201
        except sqlite3.IntegrityError:
            return '', 400
        finally:
            conn.close()
    except:
        return '', 400

@app.route('/download', methods=['GET'])
def download_product():
    name = request.args.get('name')
    if not name:
        return '', 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT data FROM products WHERE name = ?', (name,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return jsonify({'data': result[0]})
    else:
        return jsonify({'data': ''}), 200

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        request_data = request.get_json()
        if not request_data or 'name' not in request_data or 'data' not in request_data:
            return '', 400
        
        name = request_data['name']
        data = request_data['data']
        
        if not isinstance(name, str) or not isinstance(data, str):
            return '', 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if product exists and update, or create new
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        if cursor.fetchone():
            cursor.execute('UPDATE products SET data = ? WHERE name = ?', (data, name))
        else:
            cursor.execute('INSERT INTO products (name, data) VALUES (?, ?)', (name, data))
        
        conn.commit()
        conn.close()
        return '', 200
    except:
        return '', 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        if not query:
            return '', 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT data FROM products WHERE data LIKE ?', (f'%{query}%',))
        results = cursor.fetchall()
        conn.close()
        
        products = []
        for result in results:
            try:
                product = json.loads(result[0])
                if isinstance(product, dict):
                    products.append(product)
            except json.JSONDecodeError:
                continue
        
        return jsonify({'results': products})
    except:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)