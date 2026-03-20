<CODE>
from flask import Flask, request, jsonify, render_template_string
import sqlite3
import os
import html

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
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
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    ''')
    
    # Create index for faster tag searches
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags (tag)
    ''')
    
    conn.commit()
    conn.close()

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags', '')
    
    if not tags_param:
        return render_template_string('<html><body><h1>No tags provided</h1></body></html>'), 200
    
    # Split tags by comma and strip whitespace
    search_tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
    
    if not search_tags:
        return render_template_string('<html><body><h1>No valid tags provided</h1></body></html>'), 200
    
    conn = get_db()
    cursor = conn.cursor()
    
    # Build query to find products matching at least one tag
    placeholders = ','.join(['?' for _ in search_tags])
    query = f'''
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        INNER JOIN tags t ON p.id = t.product_id
        WHERE t.tag IN ({placeholders})
        ORDER BY p.product_name
    '''
    
    cursor.execute(query, search_tags)
    products = cursor.fetchall()
    
    # Get all tags for each product
    product_list = []
    for product in products:
        cursor.execute('SELECT tag FROM tags WHERE product_id = ? ORDER BY tag', (product['id'],))
        product_tags = [row['tag'] for row in cursor.fetchall()]
        product_list.append({
            'id': product['id'],
            'name': product['product_name'],
            'tags': product_tags
        })
    
    conn.close()
    
    # Generate HTML response
    html_content = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Product Recommendations</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; }
            .product { 
                border: 1px solid #ddd; 
                padding: 15px; 
                margin: 10px 0; 
                border-radius: 5px;
                background-color: #f9f9f9;
            }
            .product-name { 
                font-size: 18px; 
                font-weight: bold; 
                color: #0066cc;
                margin-bottom: 8px;
            }
            .tags { 
                color: #666; 
                font-size: 14px;
            }
            .tag {
                display: inline-block;
                background-color: #e0e0e0;
                padding: 3px 8px;
                margin: 2px;
                border-radius: 3px;
            }
            .no-results {
                color: #666;
                font-style: italic;
            }
        </style>
    </head>
    <body>
        <h1>Product Recommendations</h1>
        <p>Searched tags: ''' + html.escape(', '.join(search_tags)) + '''</p>
    '''
    
    if product_list:
        for product in product_list:
            html_content += f'''
        <div class="product">
            <div class="product-name">{html.escape(product['name'])}</div>
            <div class="tags">
                Tags: '''
            for tag in product['tags']:
                html_content += f'<span class="tag">{html.escape(tag)}</span>'
            html_content += '''
            </div>
        </div>
            '''
    else:
        html_content += '<p class="no-results">No products found matching the provided tags.</p>'
    
    html_content += '''
    </body>
    </html>
    '''
    
    return html_content, 200

@app.route('/recommender', methods=['POST'])
def post_product():
    if not request.is_json:
        return jsonify({'error': 'Content-Type must be application/json'}), 400
    
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    product_name = data.get('product_name')
    tags = data.get('tags')
    
    # Validate input
    if not product_name or not isinstance(product_name, str) or not product_name.strip():
        return jsonify({'error': 'product_name is required and must be a non-empty string'}), 400
    
    if not tags or not isinstance(tags, list):
        return jsonify({'error': 'tags is required and must be an array'}), 400
    
    if len(tags) == 0:
        return jsonify({'error': 'At least one tag is required'}), 400
    
    # Validate all tags are strings
    for tag in tags:
        if not isinstance(tag, str) or not tag.strip():
            return jsonify({'error': 'All tags must be non-empty strings'}), 400
    
    # Insert product and tags into database
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Insert product
        cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name.strip(),))
        product_id = cursor.lastrowid
        
        # Insert tags
        for tag in tags:
            cursor.execute('INSERT INTO tags (product_id, tag) VALUES (?, ?)', (product_id, tag.strip()))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Product added successfully', 'product_id': product_id}), 200
    
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'error': 'Database error occurred'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
</CODE>