import sqlite3
import json
import html
from flask import Flask, request, jsonify, Response
from contextlib import closing
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
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
                product_id INTEGER,
                tag_id INTEGER,
                FOREIGN KEY (product_id) REFERENCES products (id),
                FOREIGN KEY (tag_id) REFERENCES tags (id),
                PRIMARY KEY (product_id, tag_id)
            )
        ''')
        conn.commit()

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags')
    if not tags_param:
        return Response("Missing tags parameter", status=400)
    
    # Split tags and sanitize
    tags = [html.escape(tag.strip()) for tag in tags_param.split(',') if tag.strip()]
    
    if not tags:
        return Response("No valid tags provided", status=400)
    
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
    
    # Generate HTML response
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
            a { color: #007bff; text-decoration: none; }
            a:hover { text-decoration: underline; }
        </style>
    </head>
    <body>
        <h1>Product Recommendations</h1>
        <p>Products matching tags: {}</p>
        <ul>
    '''.format(html.escape(', '.join(tags)))
    
    if products:
        for product_id, product_name in products:
            escaped_name = html.escape(product_name)
            html_content += f'<li><a href="/product/{product_id}">{escaped_name}</a></li>\n'
    else:
        html_content += '<li>No products found matching the specified tags.</li>\n'
    
    html_content += '''
        </ul>
    </body>
    </html>
    '''
    
    return Response(html_content, mimetype='text/html')

@app.route('/recommender', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        product_name = data.get('product_name')
        tags = data.get('tags', [])
        
        if not product_name or not isinstance(product_name, str):
            return jsonify({"error": "Invalid product_name"}), 400
        
        if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
            return jsonify({"error": "Invalid tags format"}), 400
        
        # Sanitize input
        product_name = product_name.strip()
        tags = [tag.strip() for tag in tags if tag.strip()]
        
        if not product_name:
            return jsonify({"error": "Product name cannot be empty"}), 400
        
        if not tags:
            return jsonify({"error": "At least one tag is required"}), 400
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            
            # Insert product
            cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
            product_id = cursor.lastrowid
            
            # Insert tags and create relationships
            for tag in tags:
                # Insert or get existing tag
                cursor.execute('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', (tag,))
                cursor.execute('SELECT id FROM tags WHERE tag_name = ?', (tag,))
                tag_id = cursor.fetchone()[0]
                
                # Create product-tag relationship
                cursor.execute('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                             (product_id, tag_id))
            
            conn.commit()
        
        return jsonify({"message": "Product added successfully", "product_id": product_id}), 200
        
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)