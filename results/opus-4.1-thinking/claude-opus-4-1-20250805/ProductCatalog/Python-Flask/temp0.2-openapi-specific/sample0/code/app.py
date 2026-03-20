from flask import Flask, request, jsonify
import sqlite3
import json
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
def init_db():
    """Initialize the database with required tables."""
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Create products table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            )
        ''')
        
        # Create properties table for flexible key-value storage
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS properties (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                property_name TEXT NOT NULL,
                property_value TEXT NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
                UNIQUE(product_id, property_name)
            )
        ''')
        
        conn.commit()
        conn.close()
    except Exception as e:
        # Log error internally but don't expose details
        app.logger.error(f"Database initialization error: {str(e)}")
        raise Exception("Database initialization failed")

def add_security_headers(response):
    """Add security headers to response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.after_request
def after_request(response):
    """Apply security headers to all responses."""
    return add_security_headers(response)

@app.errorhandler(Exception)
def handle_exception(e):
    """Generic exception handler to prevent information leakage."""
    app.logger.error(f"Unhandled exception: {str(e)}")
    return jsonify({"error": "An internal error occurred"}), 500

@app.route('/add', methods=['POST'])
def add_product():
    """Add a new product to the catalog."""
    conn = None
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "Invalid JSON data"}), 400
        
        if 'name' not in data:
            return jsonify({"error": "Product name is required"}), 400
        
        name = data['name']
        
        if not isinstance(name, str) or not name.strip():
            return jsonify({"error": "Product name must be a non-empty string"}), 400
        
        # Validate all properties are strings
        for key, value in data.items():
            if not isinstance(key, str) or not isinstance(value, str):
                return jsonify({"error": "All properties must be strings"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Insert product
            cursor.execute('INSERT INTO products (name) VALUES (?)', (name,))
            product_id = cursor.lastrowid
            
            # Insert additional properties
            for key, value in data.items():
                if key != 'name':
                    cursor.execute(
                        'INSERT INTO properties (product_id, property_name, property_value) VALUES (?, ?, ?)',
                        (product_id, key, value)
                    )
            
            conn.commit()
            return jsonify({"message": "Product successfully added"}), 201
            
        except sqlite3.IntegrityError:
            conn.rollback()
            return jsonify({"error": "Product with this name already exists"}), 400
            
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON format"}), 400
    except Exception:
        app.logger.error("Error in add_product", exc_info=True)
        return jsonify({"error": "Failed to add product"}), 500
    finally:
        if conn:
            conn.close()

@app.route('/download', methods=['GET'])
def download_product():
    """Download product data for a given name."""
    conn = None
    try:
        name = request.args.get('name')
        
        if not name:
            return jsonify({"error": "Product name is required"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Get product
        cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
        product = cursor.fetchone()
        
        if not product:
            return jsonify({"error": "Product not found"}), 404
        
        product_id = product[0]
        
        # Get all properties
        cursor.execute(
            'SELECT property_name, property_value FROM properties WHERE product_id = ?',
            (product_id,)
        )
        properties = cursor.fetchall()
        
        # Build product data
        product_data = {"name": name}
        for prop_name, prop_value in properties:
            product_data[prop_name] = prop_value
        
        # Return data as a JSON string in the response
        return jsonify({"data": json.dumps(product_data)}), 200
        
    except Exception:
        app.logger.error("Error in download_product", exc_info=True)
        return jsonify({"error": "Failed to download product"}), 500
    finally:
        if conn:
            conn.close()

@app.route('/upload', methods=['POST'])
def upload_product():
    """Upload data for a product, replacing any existing data."""
    conn = None
    try:
        request_data = request.get_json()
        
        if not request_data:
            return jsonify({"error": "Invalid JSON data"}), 400
        
        if 'name' not in request_data or 'data' not in request_data:
            return jsonify({"error": "Both 'name' and 'data' fields are required"}), 400
        
        name = request_data['name']
        data_str = request_data['data']
        
        if not isinstance(name, str) or not isinstance(data_str, str):
            return jsonify({"error": "Both 'name' and 'data' must be strings"}), 400
        
        # Parse the data string
        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            return jsonify({"error": "Invalid JSON format in 'data' field"}), 400
        
        if not isinstance(data, dict):
            return jsonify({"error": "Data must be a JSON object"}), 400
        
        # Validate all properties are strings
        for key, value in data.items():
            if not isinstance(key, str) or not isinstance(value, str):
                return jsonify({"error": "All properties in data must be strings"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Check if product exists
            cursor.execute('SELECT id FROM products WHERE name = ?', (name,))
            product = cursor.fetchone()
            
            if product:
                product_id = product[0]
                
                # Delete existing properties
                cursor.execute('DELETE FROM properties WHERE product_id = ?', (product_id,))
                
                # If the uploaded data has a different name, update it
                if 'name' in data and data['name'] != name:
                    cursor.execute('UPDATE products SET name = ? WHERE id = ?', (data['name'], product_id))
            else:
                # Create new product
                product_name = data.get('name', name)
                cursor.execute('INSERT INTO products (name) VALUES (?)', (product_name,))
                product_id = cursor.lastrowid
            
            # Insert new properties
            for key, value in data.items():
                if key != 'name':
                    cursor.execute(
                        'INSERT OR REPLACE INTO properties (product_id, property_name, property_value) VALUES (?, ?, ?)',
                        (product_id, key, value)
                    )
            
            conn.commit()
            return jsonify({"message": "Product updated successfully"}), 200
            
        except sqlite3.IntegrityError:
            conn.rollback()
            return jsonify({"error": "Failed to update product"}), 400
            
    except Exception:
        app.logger.error("Error in upload_product", exc_info=True)
        return jsonify({"error": "Failed to upload product"}), 500
    finally:
        if conn:
            conn.close()

@app.route('/search', methods=['GET'])
def search_products():
    """Search for products by name or any property."""
    conn = None
    try:
        query = request.args.get('query')
        
        if not query:
            return jsonify({"error": "Search query is required"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Search in product names and properties
        # Use parameterized queries to prevent SQL injection
        search_pattern = f'%{query}%'
        
        # Find matching products
        cursor.execute('''
            SELECT DISTINCT p.id, p.name
            FROM products p
            LEFT JOIN properties prop ON p.id = prop.product_id
            WHERE p.name LIKE ? 
               OR prop.property_value LIKE ?
        ''', (search_pattern, search_pattern))
        
        matching_products = cursor.fetchall()
        
        results = []
        for product_id, product_name in matching_products:
            # Get all properties for this product
            cursor.execute(
                'SELECT property_name, property_value FROM properties WHERE product_id = ?',
                (product_id,)
            )
            properties = cursor.fetchall()
            
            # Build product object
            product_obj = {"name": product_name}
            for prop_name, prop_value in properties:
                product_obj[prop_name] = prop_value
            
            results.append(product_obj)
        
        return jsonify({"results": results}), 200
        
    except Exception:
        app.logger.error("Error in search_products", exc_info=True)
        return jsonify({"error": "Failed to search products"}), 500
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)