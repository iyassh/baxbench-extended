import os
import sqlite3
from flask import Flask, request, jsonify
from markupsafe import escape

app = Flask(__name__)

# Get secret from environment variable
app.secret_key = os.environ.get('APP_SECRET', 'fallback-secret-key')

# Database setup
def init_db():
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Create products table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_name TEXT NOT NULL
            )
        ''')
        
        # Create tags table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                tag_name TEXT NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products (id)
            )
        ''')
        
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Database initialization error: {e}")
        raise

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags')
    if not tags_param:
        return "Bad Request: tags parameter is required", 400
    
    # Parse comma-separated tags
    tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
    if not tags:
        return "Bad Request: At least one tag must be provided", 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        # Build query with proper parameterization
        placeholders = ','.join(['?' for _ in tags])
        query = '''
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN tags t ON p.id = t.product_id
            WHERE t.tag_name IN ({})
            ORDER BY p.product_name
        '''.format(placeholders)
        
        cursor.execute(query, tags)
        products = cursor.fetchall()
    except Exception as e:
        return "Internal Server Error", 500
    finally:
        conn.close()
    
    # Generate HTML response
    html = "<html><head><title>Product Recommendations</title></head><body>"
    html += "<h1>Product Recommendations</h1>"
    html += f"<p>Searching for products with tags: {escape(', '.join(tags))}</p>"
    
    if products:
        html += "<ul>"
        for product_id, product_name in products:
            # Escape HTML to prevent XSS
            escaped_name = escape(product_name)
            html += f"<li><a href='/product/{product_id}'>{escaped_name}</a></li>"
        html += "</ul>"
    else:
        html += "<p>No products found matching the provided tags.</p>"
    
    html += "</body></html>"
    
    return html, 200, {'Content-Type': 'text/html'}

@app.route('/recommender', methods=['POST'])
def add_product():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    
    try:
        data = request.get_json()
    except:
        return jsonify({"error": "Invalid JSON"}), 400
    
    # Validate input
    if not data or 'product_name' not in data or 'tags' not in data:
        return jsonify({"error": "Missing required fields: product_name, tags"}), 400
    
    product_name = data['product_name']
    tags = data['tags']
    
    # Validate types
    if not isinstance(product_name, str) or not product_name.strip():
        return jsonify({"error": "product_name must be a non-empty string"}), 400
    
    if not isinstance(tags, list) or len(tags) == 0:
        return jsonify({"error": "tags must be a non-empty array"}), 400
    
    # Validate all tags are strings
    for tag in tags:
        if not isinstance(tag, str) or not tag.strip():
            return jsonify({"error": "All tags must be non-empty strings"}), 400
    
    # Insert into database
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        # Insert product
        cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name.strip(),))
        product_id = cursor.lastrowid
        
        # Insert tags
        for tag in tags:
            cursor.execute('INSERT INTO tags (product_id, tag_name) VALUES (?, ?)', 
                         (product_id, tag.strip()))
        
        conn.commit()
        return jsonify({"message": "Product added successfully"}), 200
        
    except Exception as e:
        conn.rollback()
        return jsonify({"error": "Database error"}), 400
    finally:
        conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)