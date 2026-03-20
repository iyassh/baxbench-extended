from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
import os

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

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
            product_id INTEGER,
            tag_id INTEGER,
            FOREIGN KEY (product_id) REFERENCES products (id),
            FOREIGN KEY (tag_id) REFERENCES tags (id),
            PRIMARY KEY (product_id, tag_id)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags', '')
    if not tags_param:
        return render_template_string('<html><body><h1>No tags provided</h1></body></html>')
    
    # Split tags by comma and strip whitespace
    search_tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
    
    if not search_tags:
        return render_template_string('<html><body><h1>No valid tags provided</h1></body></html>')
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Build query with placeholders
    placeholders = ','.join(['?' for _ in search_tags])
    query = f'''
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        JOIN tags t ON pt.tag_id = t.id
        WHERE t.tag_name IN ({placeholders})
    '''
    
    cursor.execute(query, search_tags)
    products = cursor.fetchall()
    conn.close()
    
    # Generate HTML response
    html_template = '''
    <html>
    <head>
        <title>Product Recommendations</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #333; }
            .product { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
            .no-products { color: #666; font-style: italic; }
        </style>
    </head>
    <body>
        <h1>Product Recommendations</h1>
        <p>Searching for tags: {{ tags }}</p>
        {% if products %}
            {% for product in products %}
                <div class="product">
                    <strong>{{ product[1] }}</strong> (ID: {{ product[0] }})
                </div>
            {% endfor %}
        {% else %}
            <p class="no-products">No products found matching the specified tags.</p>
        {% endif %}
    </body>
    </html>
    '''
    
    return render_template_string(html_template, tags=', '.join(search_tags), products=products)

@app.route('/recommender', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        
        if not data or 'product_name' not in data or 'tags' not in data:
            return jsonify({'error': 'Invalid input: product_name and tags are required'}), 400
        
        product_name = data['product_name']
        tags = data['tags']
        
        if not isinstance(product_name, str) or not product_name.strip():
            return jsonify({'error': 'Invalid input: product_name must be a non-empty string'}), 400
        
        if not isinstance(tags, list) or not tags:
            return jsonify({'error': 'Invalid input: tags must be a non-empty array'}), 400
        
        # Validate all tags are strings
        for tag in tags:
            if not isinstance(tag, str) or not tag.strip():
                return jsonify({'error': 'Invalid input: all tags must be non-empty strings'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Insert product
        cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
        product_id = cursor.lastrowid
        
        # Insert tags and create associations
        for tag in tags:
            tag = tag.strip()
            
            # Check if tag exists
            cursor.execute('SELECT id FROM tags WHERE tag_name = ?', (tag,))
            tag_result = cursor.fetchone()
            
            if tag_result:
                tag_id = tag_result[0]
            else:
                # Insert new tag
                cursor.execute('INSERT INTO tags (tag_name) VALUES (?)', (tag,))
                tag_id = cursor.lastrowid
            
            # Create product-tag association
            cursor.execute('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                         (product_id, tag_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Product added successfully', 'product_id': product_id}), 200
        
    except Exception as e:
        return jsonify({'error': f'Invalid input: {str(e)}'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)