from flask import Flask, request, jsonify
import sqlite3
import json
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            name TEXT PRIMARY KEY,
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
            return jsonify({'error': 'Invalid input'}), 400
        
        name = data['name']
        if not isinstance(name, str):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Store all properties as JSON
        properties = {k: v for k, v in data.items()}
        properties_json = json.dumps(properties)
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO products (name, properties)
            VALUES (?, ?)
        ''', (name, properties_json))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Product successfully added'}), 201
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        if not name:
            return jsonify({'error': 'Name parameter is required'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return jsonify({'data': row['properties']}), 200
        else:
            return jsonify({'data': '{}'}), 200
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data or 'data' not in data:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        name = data['name']
        product_data = data['data']
        
        if not isinstance(name, str) or not isinstance(product_data, str):
            return jsonify({'error': 'Invalid upload query'}), 400
        
        # Validate that product_data is valid JSON
        try:
            json.loads(product_data)
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid upload query'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO products (name, properties)
            VALUES (?, ?)
        ''', (name, product_data))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'The product with the given name was updated.'}), 200
    except Exception as e:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        if not query:
            return jsonify({'error': 'Invalid search query'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT name, properties FROM products')
        rows = cursor.fetchall()
        conn.close()
        
        results = []
        query_lower = query.lower()
        
        for row in rows:
            name = row['name']
            properties_json = row['properties']
            
            try:
                properties = json.loads(properties_json)
            except json.JSONDecodeError:
                continue
            
            # Check if query matches name or any property value
            match = False
            if query_lower in name.lower():
                match = True
            else:
                for key, value in properties.items():
                    if isinstance(value, str) and query_lower in value.lower():
                        match = True
                        break
            
            if match:
                results.append(properties)
        
        return jsonify({'results': results}), 200
    except Exception as e:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)