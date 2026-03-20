import sqlite3
import json
import os
from flask import Flask, request, jsonify, make_response
from werkzeug.exceptions import BadRequest
import logging

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Configure logging to avoid information disclosure
logging.basicConfig(level=logging.ERROR)
app.logger.setLevel(logging.ERROR)

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

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Error handler to prevent information disclosure
@app.errorhandler(Exception)
def handle_error(e):
    app.logger.error(f"An error occurred: {str(e)}")
    if isinstance(e, BadRequest):
        return jsonify({"error": "Bad request"}), 400
    return jsonify({"error": "Internal server error"}), 500

@app.route('/add', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        name = data.get('name')
        if not isinstance(name, str) or not name.strip():
            return jsonify({"error": "Invalid input"}), 400
        
        # Validate all additional properties are strings
        for key, value in data.items():
            if not isinstance(value, str):
                return jsonify({"error": "Invalid input"}), 400
        
        properties = json.dumps(data)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Use parameterized query to prevent SQL injection
            cursor.execute(
                "INSERT INTO products (name, properties) VALUES (?, ?)",
                (name, properties)
            )
            conn.commit()
            return jsonify({"message": "Product successfully added"}), 201
        except sqlite3.IntegrityError:
            return jsonify({"error": "Product already exists"}), 400
        finally:
            conn.close()
            
    except Exception:
        return jsonify({"error": "Invalid input"}), 400

@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        if not name:
            return jsonify({"error": "Name parameter is required"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        cursor.execute(
            "SELECT properties FROM products WHERE name = ?",
            (name,)
        )
        result = cursor.fetchone()
        conn.close()
        
        if result:
            return jsonify({"data": result[0]}), 200
        else:
            return jsonify({"data": ""}), 200
            
    except Exception:
        return jsonify({"error": "Invalid request"}), 400

@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        data = request.get_json()
        if not data or 'name' not in data or 'data' not in data:
            return jsonify({"error": "Invalid upload query"}), 400
        
        name = data.get('name')
        product_data = data.get('data')
        
        if not isinstance(name, str) or not isinstance(product_data, str):
            return jsonify({"error": "Invalid upload query"}), 400
        
        # Validate that product_data is valid JSON
        try:
            parsed_data = json.loads(product_data)
            if not isinstance(parsed_data, dict):
                return jsonify({"error": "Invalid upload query"}), 400
            # Ensure all values are strings
            for key, value in parsed_data.items():
                if not isinstance(value, str):
                    return jsonify({"error": "Invalid upload query"}), 400
        except (json.JSONDecodeError, TypeError):
            return jsonify({"error": "Invalid upload query"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        cursor.execute(
            "UPDATE products SET properties = ? WHERE name = ?",
            (product_data, name)
        )
        
        if cursor.rowcount == 0:
            # Product doesn't exist, insert it
            try:
                cursor.execute(
                    "INSERT INTO products (name, properties) VALUES (?, ?)",
                    (name, product_data)
                )
            except sqlite3.IntegrityError:
                conn.close()
                return jsonify({"error": "Invalid upload query"}), 400
        
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Product updated"}), 200
        
    except Exception:
        return jsonify({"error": "Invalid upload query"}), 400

@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        if not query:
            return jsonify({"error": "Invalid search query"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Get all products
        cursor.execute("SELECT name, properties FROM products")
        all_products = cursor.fetchall()
        conn.close()
        
        results = []
        query_lower = query.lower()
        
        for name, properties_str in all_products:
            try:
                properties = json.loads(properties_str)
                
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
                    
            except (json.JSONDecodeError, TypeError):
                continue
        
        return jsonify({"results": results}), 200
        
    except Exception:
        return jsonify({"error": "Invalid search query"}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)