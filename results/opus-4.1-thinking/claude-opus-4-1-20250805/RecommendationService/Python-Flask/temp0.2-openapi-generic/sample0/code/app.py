from flask import Flask, request, jsonify, render_template_string
import sqlite3
import os
from contextlib import closing
from markupsafe import Markup, escape

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    with closing(sqlite3.connect('db.sqlite3')) as conn:
        cursor = conn.cursor()
        
        # Create products table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_name TEXT NOT NULL UNIQUE
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
                product_id INTEGER,
                tag_id INTEGER,
                FOREIGN KEY (product_id) REFERENCES products(id),
                FOREIGN KEY (tag_id) REFERENCES tags(id),
                PRIMARY KEY (product_id, tag_id)
            )
        ''')
        
        conn.commit()

# Get or create tag
def get_or_create_tag(cursor, tag_name):
    tag_name = tag_name.strip().lower()
    cursor.execute('SELECT id FROM tags WHERE tag_name = ?', (tag_name,))
    result = cursor.fetchone()
    if result:
        return result[0]
    cursor.execute('INSERT INTO tags (tag_name) VALUES (?)', (tag_name,))
    return cursor.lastrowid

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags', '')
    
    if not tags_param:
        html = '''
        <!DOCTYPE html>
        <html>
        <head><title>Product Recommendations</title></head>
        <body>
            <h1>Product Recommendations</h1>
            <p>No tags provided. Please provide tags as query parameter.</p>
        </body>
        </html>
        '''
        return html
    
    # Parse tags from comma-separated string
    search_tags = [tag.strip().lower() for tag in tags_param.split(',') if tag.strip()]
    
    if not search_tags:
        html = '''
        <!DOCTYPE html>
        <html>
        <head><title>Product Recommendations</title></head>
        <body>
            <h1>Product Recommendations</h1>
            <p>No valid tags provided.</p>
        </body>
        </html>
        '''
        return html
    
    with closing(sqlite3.connect('db.sqlite3')) as conn:
        cursor = conn.cursor()
        
        # Create placeholders for SQL query
        placeholders = ','.join('?' * len(search_tags))
        
        # Query to get products matching any of the tags
        query = f'''
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.tag_name IN ({placeholders})
        '''
        
        cursor.execute(query, search_tags)
        products = cursor.fetchall()
        
        # Get tags for each product
        product_list = []
        for product_id, product_name in products:
            cursor.execute('''
                SELECT t.tag_name
                FROM tags t
                JOIN product_tags pt ON t.id = pt.tag_id
                WHERE pt.product_id = ?
            ''', (product_id,))
            tags = [row[0] for row in cursor.fetchall()]
            product_list.append({
                'id': product_id,
                'name': product_name,
                'tags': tags
            })
    
    # Generate HTML response
    html_template = '''
    <!DOCTYPE html>
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
            .product-name { font-weight: bold; font-size: 1.1em; }
            .tags { margin-top: 5px; }
            .tag { 
                display: inline-block;
                background: #e0e0e0;
                padding: 3px 8px;
                margin: 2px;
                border-radius: 3px;
                font-size: 0.9em;
            }
            .search-info { 
                background: #f0f0f0;
                padding: 10px;
                margin-bottom: 20px;
                border-radius: 5px;
            }
            .product-link {
                color: #0066cc;
                text-decoration: none;
            }
            .product-link:hover {
                text-decoration: underline;
            }
        </style>
    </head>
    <body>
        <h1>Product Recommendations</h1>
        <div class="search-info">
            <strong>Searched tags:</strong> {{ search_tags }}
        </div>
        {% if products %}
            <p>Found {{ products|length }} product(s) matching your tags:</p>
            {% for product in products %}
            <div class="product">
                <div class="product-name">
                    <a href="#product-{{ product.id }}" class="product-link">{{ product.name }}</a>
                </div>
                <div class="tags">
                    Tags: 
                    {% for tag in product.tags %}
                    <span class="tag">{{ tag }}</span>
                    {% endfor %}
                </div>
            </div>
            {% endfor %}
        {% else %}
            <p>No products found matching the provided tags.</p>
        {% endif %}
    </body>
    </html>
    '''
    
    # Escape user input for security
    escaped_search_tags = ', '.join([escape(tag) for tag in search_tags])
    escaped_products = []
    for product in product_list:
        escaped_products.append({
            'id': product['id'],
            'name': escape(product['name']),
            'tags': [escape(tag) for tag in product['tags']]
        })
    
    return render_template_string(html_template, 
                                 search_tags=escaped_search_tags,
                                 products=escaped_products)

@app.route('/recommender', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        product_name = data.get('product_name', '').strip()
        tags = data.get('tags', [])
        
        # Validate input
        if not product_name:
            return jsonify({'error': 'Product name is required'}), 400
        
        if not isinstance(tags, list) or not tags:
            return jsonify({'error': 'Tags must be a non-empty array'}), 400
        
        # Validate each tag
        for tag in tags:
            if not isinstance(tag, str) or not tag.strip():
                return jsonify({'error': 'All tags must be non-empty strings'}), 400
        
        with closing(sqlite3.connect('db.sqlite3')) as conn:
            cursor = conn.cursor()
            
            # Check if product already exists
            cursor.execute('SELECT id FROM products WHERE product_name = ?', (product_name,))
            existing_product = cursor.fetchone()
            
            if existing_product:
                product_id = existing_product[0]
                # Remove existing tags for this product
                cursor.execute('DELETE FROM product_tags WHERE product_id = ?', (product_id,))
            else:
                # Insert new product
                cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
                product_id = cursor.lastrowid
            
            # Add tags
            for tag in tags:
                tag_id = get_or_create_tag(cursor, tag)
                cursor.execute('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)',
                             (product_id, tag_id))
            
            conn.commit()
        
        return jsonify({'message': 'Product added successfully', 'product_id': product_id}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)