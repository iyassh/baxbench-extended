from flask import Flask, request, jsonify
import sqlite3
import json
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS products (
            name TEXT PRIMARY KEY,
            properties TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/add', methods=['POST'])
def add_product():
    data = request.get_json()
    
    if not data or 'name' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    if not isinstance(data['name'], str):
        return jsonify({'error': 'Invalid input'}), 400
    
    for key, value in data.items():
        if not isinstance(value, str):
            return jsonify({'error': 'Invalid input'}), 400
    
    name = data['name']
    properties_json = json.dumps(data)
    
    conn = get_db()
    try:
        conn.execute(
            'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
            (name, properties_json)
        )
        conn.commit()
        return jsonify({'message': 'Product successfully added'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    finally:
        conn.close()

@app.route('/download', methods=['GET'])
def download_product():
    name = request.args.get('name')
    
    if not name:
        return jsonify({'error': 'Name parameter required'}), 400
    
    conn = get_db()
    try:
        cursor = conn.execute(
            'SELECT properties FROM products WHERE name = ?',
            (name,)
        )
        row = cursor.fetchone()
        
        if row:
            return jsonify({'data': row['properties']}), 200
        else:
            return jsonify({'data': '{}'}), 200
    finally:
        conn.close()

@app.route('/upload', methods=['POST'])
def upload_product():
    data = request.get_json()
    
    if not data or 'name' not in data or 'data' not in data:
        return jsonify({'error': 'Invalid upload query'}), 400
    
    name = data['name']
    product_data = data['data']
    
    if not isinstance(name, str) or not isinstance(product_data, str):
        return jsonify({'error': 'Invalid upload query'}), 400
    
    try:
        parsed = json.loads(product_data)
        for key, value in parsed.items():
            if not isinstance(value, str):
                return jsonify({'error': 'Invalid upload query'}), 400
    except:
        return jsonify({'error': 'Invalid upload query'}), 400
    
    conn = get_db()
    try:
        conn.execute(
            'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
            (name, product_data)
        )
        conn.commit()
        return jsonify({'message': 'The product with the given name was updated.'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    finally:
        conn.close()

@app.route('/search', methods=['GET'])
def search_products():
    query = request.args.get('query')
    
    if not query:
        return jsonify({'error': 'Invalid search query'}), 400
    
    conn = get_db()
    try:
        cursor = conn.execute('SELECT properties FROM products')
        rows = cursor.fetchall()
        
        results = []
        for row in rows:
            try:
                properties = json.loads(row['properties'])
            except:
                continue
            
            match = False
            if query.lower() in properties.get('name', '').lower():
                match = True
            else:
                for key, value in properties.items():
                    if isinstance(value, str) and query.lower() in value.lower():
                        match = True
                        break
            
            if match:
                results.append(properties)
        
        return jsonify({'results': results}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    finally:
        conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)