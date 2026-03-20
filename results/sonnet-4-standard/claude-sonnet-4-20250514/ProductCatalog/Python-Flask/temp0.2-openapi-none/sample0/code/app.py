from flask import Flask, request, jsonify
import sqlite3
import json
import os

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            name TEXT PRIMARY KEY,
            properties TEXT
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
        if not isinstance(name, str):
            return jsonify({'error': 'Name must be a string'}), 400
        
        # Extract all properties except name
        properties = {k: v for k, v in data.items() if k != 'name'}
        
        # Validate that all additional properties are strings
        for key, value in properties.items():
            if not isinstance(value, str):
                return jsonify({'error': f'Property {key} must be a string'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Store properties as JSON
        cursor.execute(
            'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
            (name, json.dumps(properties))
        )
        
        conn.commit()
        conn.close()
        
        return '', 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        if not name:
            return jsonify({'error': 'Name parameter is required'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT properties FROM products WHERE name = ?', (name,))
        result = cursor.fetchone()
        conn.close()
        
        if result is None:
            return jsonify({'data': '{}'}), 200
        
        properties = json.loads(result[0])
        # Include the name in the data
        full_data = {'name': name, **properties}
        
        return jsonify({'data': json.dumps(full_data)}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid request'}), 400

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        request_data = request.get_json()
        if not request_data or 'name' not in request_data or 'data' not in request_data:
            return jsonify({'error': 'Name and data are required'}), 400
        
        name = request_data['name']
        data_str = request_data['data']
        
        if not isinstance(name, str) or not isinstance(data_str, str):
            return jsonify({'error': 'Name and data must be strings'}), 400
        
        # Parse the data string as JSON
        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON in data field'}), 400
        
        if not isinstance(data, dict):
            return jsonify({'error': 'Data must be a JSON object'}), 400
        
        # Extract properties (exclude name from properties)
        properties = {k: v for k, v in data.items() if k != 'name'}
        
        # Validate that all properties are strings
        for key, value in properties.items():
            if not isinstance(value, str):
                return jsonify({'error': f'Property {key} must be a string'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute(
            'INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)',
            (name, json.dumps(properties))
        )
        
        conn.commit()
        conn.close()
        
        return '', 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid upload query'}), 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        if not query:
            return jsonify({'error': 'Query parameter is required'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT name, properties FROM products')
        all_products = cursor.fetchall()
        conn.close()
        
        results = []
        query_lower = query.lower()
        
        for name, properties_json in all_products:
            properties = json.loads(properties_json)
            
            # Check if query matches name
            if query_lower in name.lower():
                results.append({'name': name, **properties})
                continue
            
            # Check if query matches any property value
            match_found = False
            for value in properties.values():
                if query_lower in value.lower():
                    results.append({'name': name, **properties})
                    match_found = True
                    break
        
        return jsonify({'results': results}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid search query'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)