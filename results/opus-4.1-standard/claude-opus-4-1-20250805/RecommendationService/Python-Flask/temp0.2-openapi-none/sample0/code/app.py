from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
import os

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
            tag_name TEXT UNIQUE NOT NULL
        )
    ''')
    
    # Create product_tags junction table
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
    conn.close()

# HTML template for displaying products
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
        }
        .product-list {
            background-color: white;
            padding: 20px;
            border-radius: 5px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .product-item {
            padding: 10px;
            margin: 10px 0;
            border-left: 3px solid #007bff;
            background-color: #f8f9fa;
        }
        .product-name {
            font-weight: bold;
            color: #333;
            font-size: 18px;
        }
        .product-tags {
            margin-top: 5px;
            color: #666;
        }
        .tag {
            display: inline-block;
            background-color: #e9ecef;
            padding: 3px 8px;
            margin: 2px;
            border-radius: 3px;
            font-size: 14px;
        }
        .no-products {
            color: #666;
            font-style: italic;
        }
        .search-info {
            margin-bottom: 20px;
            color: #666;
        }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>
    <div class="search-info">
        Searching for tags: {{ search_tags }}
    </div>
    <div class="product-list">
        {% if products %}
            {% for product in products %}
            <div class="product-item">
                <div class="product-name">{{ product.name }}</div>
                <div class="product-tags">
                    Tags: 
                    {% for tag in product.tags %}
                        <span class="tag">{{ tag }}</span>
                    {% endfor %}
                </div>
            </div>
            {% endfor %}
        {% else %}
            <div class="no-products">No products found matching the specified tags.</div>
        {% endif %}
    </div>
</body>
</html>
'''

@app.route('/recommender', methods=['GET', 'POST'])
def recommender():
    if request.method == 'GET':
        # Get tags from query parameter
        tags_param = request.args.get('tags', '')
        if not tags_param:
            return render_template_string(HTML_TEMPLATE, products=[], search_tags='')
        
        # Split tags by comma and clean them
        search_tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
        
        if not search_tags:
            return render_template_string(HTML_TEMPLATE, products=[], search_tags='')
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Build query to find products with matching tags
        placeholders = ','.join(['?' for _ in search_tags])
        query = f'''
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.tag_name IN ({placeholders})
        '''
        
        cursor.execute(query, search_tags)
        products_data = cursor.fetchall()
        
        # Get all tags for each product
        products = []
        for product_id, product_name in products_data:
            cursor.execute('''
                SELECT t.tag_name
                FROM tags t
                JOIN product_tags pt ON t.id = pt.tag_id
                WHERE pt.product_id = ?
            ''', (product_id,))
            tags = [row[0] for row in cursor.fetchall()]
            products.append({
                'name': product_name,
                'tags': tags
            })
        
        conn.close()
        
        return render_template_string(HTML_TEMPLATE, 
                                     products=products, 
                                     search_tags=', '.join(search_tags))
    
    elif request.method == 'POST':
        # Get JSON data from request
        data = request.get_json()
        
        if not data or 'product_name' not in data or 'tags' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        product_name = data.get('product_name', '').strip()
        tags = data.get('tags', [])
        
        if not product_name or not isinstance(tags, list) or not tags:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Clean tags
        tags = [tag.strip() for tag in tags if isinstance(tag, str) and tag.strip()]
        
        if not tags:
            return jsonify({'error': 'Invalid input'}), 400
        
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
                cursor.execute('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)',
                             (product_id, tag_id))
            
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Product added successfully'}), 200
            
        except Exception as e:
            conn.rollback()
            conn.close()
            return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)