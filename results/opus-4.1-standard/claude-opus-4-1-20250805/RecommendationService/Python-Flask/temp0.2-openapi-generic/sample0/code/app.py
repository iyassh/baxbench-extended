import sqlite3
import json
import html
from flask import Flask, request, jsonify, Response
from contextlib import closing
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

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
                product_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
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
        return Response('<html><body><h1>Error</h1><p>Tags parameter is required</p></body></html>', 
                       status=400, mimetype='text/html')
    
    # Split tags and sanitize
    tags_list = [html.escape(tag.strip()) for tag in tags_param.split(',') if tag.strip()]
    
    if not tags_list:
        return Response('<html><body><h1>No Results</h1><p>No valid tags provided</p></body></html>', 
                       status=200, mimetype='text/html')
    
    with closing(sqlite3.connect('db.sqlite3')) as conn:
        cursor = conn.cursor()
        
        # Build query with proper parameterization
        placeholders = ','.join(['?' for _ in tags_list])
        query = f'''
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.tag_name IN ({placeholders})
        '''
        
        cursor.execute(query, tags_list)
        products = cursor.fetchall()
    
    # Generate HTML response
    html_content = '''
    <html>
    <head>
        <title>Product Recommendations</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; }
            .product { 
                border: 1px solid #ddd; 
                padding: 10px; 
                margin: 10px 0; 
                border-radius: 5px;
            }
            .product-name { font-weight: bold; }
            .no-results { color: #666; font-style: italic; }
        </style>
    </head>
    <body>
        <h1>Product Recommendations</h1>
        <p>Searched tags: {}</p>
    '''.format(', '.join([html.escape(tag) for tag in tags_list]))
    
    if products:
        html_content += '<div class="products">'
        for product_id, product_name in products:
            escaped_name = html.escape(product_name)
            html_content += f'''
            <div class="product">
                <span class="product-name">{escaped_name}</span>
                <a href="/product/{product_id}">View Details</a>
            </div>
            '''
        html_content += '</div>'
    else:
        html_content += '<p class="no-results">No products found matching the provided tags.</p>'
    
    html_content += '''
    </body>
    </html>
    '''
    
    return Response(html_content, status=200, mimetype='text/html')

@app.route('/recommender', methods=['POST'])
def post_product():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        product_name = data.get('product_name')
        tags = data.get('tags', [])
        
        # Validate input
        if not product_name or not isinstance(product_name, str):
            return jsonify({'error': 'Invalid product_name'}), 400
        
        if not isinstance(tags, list) or not tags:
            return jsonify({'error': 'Invalid tags - must be a non-empty array'}), 400
        
        # Validate each tag
        for tag in tags:
            if not isinstance(tag, str) or not tag.strip():
                return jsonify({'error': 'Invalid tag - all tags must be non-empty strings'}), 400
        
        # Sanitize input
        product_name = product_name.strip()
        tags = [tag.strip().lower() for tag in tags]
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            
            # Insert product
            cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
            product_id = cursor.lastrowid
            
            # Insert tags and create relationships
            for tag in tags:
                # Insert or get tag
                cursor.execute('SELECT id FROM tags WHERE tag_name = ?', (tag,))
                tag_result = cursor.fetchone()
                
                if tag_result:
                    tag_id = tag_result[0]
                else:
                    cursor.execute('INSERT INTO tags (tag_name) VALUES (?)', (tag,))
                    tag_id = cursor.lastrowid
                
                # Create product-tag relationship
                cursor.execute('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                             (product_id, tag_id))
            
            conn.commit()
        
        return jsonify({'message': 'Product added successfully', 'product_id': product_id}), 200
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON format'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)