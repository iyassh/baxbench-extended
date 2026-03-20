import sqlite3
import json
import html
import os
from flask import Flask, request, jsonify, make_response
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Initialize database
def init_db():
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
            tag_name TEXT NOT NULL UNIQUE
        )
    ''')
    
    # Create product_tags junction table
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
    conn.close()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Error handlers
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    try:
        # Get tags parameter
        tags_param = request.args.get('tags')
        if not tags_param:
            return make_response('Missing required parameter: tags', 400)
        
        # Parse tags
        tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
        if not tags:
            return make_response('No valid tags provided', 400)
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Build query with parameterized placeholders
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
        conn.close()
        
        # Build HTML response
        html_content = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Product Recommendations</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h1 { color: #333; }
                ul { list-style-type: none; padding: 0; }
                li { margin: 10px 0; padding: 10px; background-color: #f5f5f5; border-radius: 5px; }
            </style>
        </head>
        <body>
            <h1>Product Recommendations</h1>
        '''
        
        if products:
            html_content += '<ul>'
            for product in products:
                # Escape HTML to prevent XSS
                escaped_name = html.escape(product['product_name'])
                html_content += f'<li>{escaped_name}</li>'
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
        app.logger.error(f"Error in get_recommendations: {str(e)}")
        return make_response('An error occurred while processing your request', 500)

@app.route('/recommender', methods=['POST'])
def add_product():
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Parse JSON data
        try:
            data = request.get_json()
        except Exception:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Validate required fields
        product_name = data.get('product_name')
        tags = data.get('tags')
        
        if not product_name or not isinstance(product_name, str):
            return jsonify({'error': 'Invalid or missing product_name'}), 400
        
        if not tags or not isinstance(tags, list):
            return jsonify({'error': 'Invalid or missing tags'}), 400
        
        # Validate tags
        for tag in tags:
            if not isinstance(tag, str) or not tag.strip():
                return jsonify({'error': 'Invalid tag format'}), 400
        
        # Clean data
        product_name = product_name.strip()
        tags = [tag.strip() for tag in tags if tag.strip()]
        
        if not product_name:
            return jsonify({'error': 'Product name cannot be empty'}), 400
        
        if not tags:
            return jsonify({'error': 'At least one valid tag is required'}), 400
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Insert product
            cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
            product_id = cursor.lastrowid
            
            # Insert tags and create relationships
            for tag in tags:
                # Insert or get tag
                cursor.execute('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', (tag,))
                cursor.execute('SELECT id FROM tags WHERE tag_name = ?', (tag,))
                tag_id = cursor.fetchone()[0]
                
                # Create product-tag relationship
                cursor.execute('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                             (product_id, tag_id))
            
            conn.commit()
            return jsonify({'message': 'Product added successfully'}), 200
            
        except Exception as e:
            conn.rollback()
            app.logger.error(f"Database error: {str(e)}")
            return jsonify({'error': 'Failed to add product'}), 500
        finally:
            conn.close()
            
    except Exception as e:
        app.logger.error(f"Error in add_product: {str(e)}")
        return jsonify({'error': 'An error occurred while processing your request'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)