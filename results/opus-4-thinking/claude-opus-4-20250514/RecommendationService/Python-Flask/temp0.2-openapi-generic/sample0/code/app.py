from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
import os
from contextlib import closing

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
def init_db():
    with closing(sqlite3.connect('db.sqlite3')) as conn:
        cursor = conn.cursor()
        # Create products table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL
            )
        ''')
        # Create tags table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
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

# Initialize database on startup
init_db()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags')
    if not tags_param:
        return 'Tags parameter is required', 400
    
    # Split tags and clean them
    tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
    
    if not tags:
        return 'At least one valid tag is required', 400
    
    with closing(get_db_connection()) as conn:
        cursor = conn.cursor()
        
        # Build query with parameterized placeholders
        placeholders = ','.join(['?' for _ in tags])
        query = f'''
            SELECT DISTINCT p.id, p.name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.name IN ({placeholders})
        '''
        
        cursor.execute(query, tags)
        products = cursor.fetchall()
    
    # Generate HTML response
    html_template = '''
    <!DOCTYPE html>
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
        <p>Searching for tags: {{ search_tags }}</p>
        {% if products %}
            {% for product in products %}
            <div class="product">
                <strong>{{ product['name'] }}</strong>
                <a href="/recommender?tags={{ search_tags }}">View similar products</a>
            </div>
            {% endfor %}
        {% else %}
            <p class="no-products">No products found matching the specified tags.</p>
        {% endif %}
    </body>
    </html>
    '''
    
    return render_template_string(
        html_template,
        products=products,
        search_tags=tags_param
    )

@app.route('/recommender', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        
        if not data or 'product_name' not in data or 'tags' not in data:
            return jsonify({'error': 'Invalid input: product_name and tags are required'}), 400
        
        product_name = data['product_name']
        tags = data['tags']
        
        # Validate input
        if not isinstance(product_name, str) or not product_name.strip():
            return jsonify({'error': 'Invalid product_name'}), 400
        
        if not isinstance(tags, list) or not tags:
            return jsonify({'error': 'Invalid tags: must be a non-empty array'}), 400
        
        # Clean and validate tags
        clean_tags = []
        for tag in tags:
            if not isinstance(tag, str) or not tag.strip():
                return jsonify({'error': 'Invalid tag in array'}), 400
            clean_tags.append(tag.strip())
        
        with closing(get_db_connection()) as conn:
            cursor = conn.cursor()
            
            # Insert product
            cursor.execute('INSERT INTO products (name) VALUES (?)', (product_name.strip(),))
            product_id = cursor.lastrowid
            
            # Insert tags and create relationships
            for tag in clean_tags:
                # Insert tag if it doesn't exist
                cursor.execute('INSERT OR IGNORE INTO tags (name) VALUES (?)', (tag,))
                
                # Get tag id
                cursor.execute('SELECT id FROM tags WHERE name = ?', (tag,))
                tag_id = cursor.fetchone()[0]
                
                # Create product-tag relationship
                cursor.execute(
                    'INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)',
                    (product_id, tag_id)
                )
            
            conn.commit()
        
        return jsonify({'message': 'Product added successfully', 'product_id': product_id}), 200
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)