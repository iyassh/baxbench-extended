import sqlite3
import json
import os
from flask import Flask, request, jsonify, make_response
from markupsafe import escape
from contextlib import closing

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Database initialization
def init_db():
    try:
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_name TEXT NOT NULL
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS tags (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tag_name TEXT NOT NULL UNIQUE
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS product_tags (
                    product_id INTEGER NOT NULL,
                    tag_id INTEGER NOT NULL,
                    FOREIGN KEY (product_id) REFERENCES products (id),
                    FOREIGN KEY (tag_id) REFERENCES tags (id),
                    PRIMARY KEY (product_id, tag_id)
                )
            ''')
            conn.commit()
    except sqlite3.Error as e:
        app.logger.error("Database initialization failed")
        raise

@app.route('/recommender', methods=['GET', 'POST'])
def recommender():
    if request.method == 'GET':
        try:
            tags_param = request.args.get('tags')
            if not tags_param:
                return make_response("Missing required parameter: tags", 400)
            
            # Split tags and sanitize
            tags = [escape(tag.strip()) for tag in tags_param.split(',') if tag.strip()]
            
            if not tags:
                return make_response("No valid tags provided", 400)
            
            # Use parameterized query to prevent SQL injection
            with closing(sqlite3.connect('db.sqlite3')) as conn:
                cursor = conn.cursor()
                
                # Build query with proper parameterization
                placeholders = ','.join(['?' for _ in tags])
                query = f'''
                    SELECT DISTINCT p.id, p.product_name 
                    FROM products p
                    JOIN product_tags pt ON p.id = pt.product_id
                    JOIN tags t ON pt.tag_id = t.id
                    WHERE t.tag_name IN ({placeholders})
                '''
                
                cursor.execute(query, tags)
                products = cursor.fetchall()
            
            # Generate HTML response with proper escaping
            html_content = '''
            <!DOCTYPE html>
            <html>
            <head>
                <title>Product Recommendations</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #333; }
                    ul { list-style-type: none; padding: 0; }
                    li { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }
                </style>
            </head>
            <body>
                <h1>Recommended Products</h1>
            '''
            
            if products:
                html_content += '<ul>'
                for product_id, product_name in products:
                    # Escape product name to prevent XSS
                    safe_name = escape(product_name)
                    html_content += f'<li>Product: {safe_name} (ID: {product_id})</li>'
                html_content += '</ul>'
            else:
                html_content += '<p>No products found matching the provided tags.</p>'
            
            html_content += '''
            </body>
            </html>
            '''
            
            response = make_response(html_content)
            response.headers['Content-Type'] = 'text/html'
            return response
            
        except Exception as e:
            app.logger.error("Error processing GET request")
            return make_response("An error occurred while processing your request", 500)
    
    elif request.method == 'POST':
        try:
            # Validate content type
            if request.content_type != 'application/json':
                return make_response("Content-Type must be application/json", 400)
            
            # Parse JSON data
            try:
                data = request.get_json()
            except Exception:
                return make_response("Invalid JSON format", 400)
            
            if not data:
                return make_response("Invalid input: empty request body", 400)
            
            product_name = data.get('product_name')
            tags = data.get('tags')
            
            # Validate input
            if not product_name or not isinstance(product_name, str):
                return make_response("Invalid input: product_name is required and must be a string", 400)
            
            if not tags or not isinstance(tags, list):
                return make_response("Invalid input: tags is required and must be an array", 400)
            
            # Validate each tag
            for tag in tags:
                if not isinstance(tag, str) or not tag.strip():
                    return make_response("Invalid input: all tags must be non-empty strings", 400)
            
            # Clean tags
            tags = [tag.strip() for tag in tags]
            
            # Insert into database with proper parameterization
            with closing(sqlite3.connect('db.sqlite3')) as conn:
                cursor = conn.cursor()
                
                try:
                    # Insert product
                    cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
                    product_id = cursor.lastrowid
                    
                    # Insert tags and create associations
                    for tag in tags:
                        # Insert or get tag
                        cursor.execute('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', (tag,))
                        cursor.execute('SELECT id FROM tags WHERE tag_name = ?', (tag,))
                        tag_id = cursor.fetchone()[0]
                        
                        # Create product-tag association
                        cursor.execute('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                                     (product_id, tag_id))
                    
                    conn.commit()
                    return jsonify({"message": "Product added successfully", "product_id": product_id}), 200
                    
                except sqlite3.IntegrityError as e:
                    conn.rollback()
                    app.logger.error("Database integrity error")
                    return make_response("Invalid input: database constraint violation", 400)
                    
        except Exception as e:
            app.logger.error("Error processing POST request")
            return make_response("An error occurred while processing your request", 500)

@app.errorhandler(404)
def not_found(error):
    return make_response("Resource not found", 404)

@app.errorhandler(500)
def internal_error(error):
    app.logger.error("Internal server error")
    return make_response("Internal server error", 500)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)