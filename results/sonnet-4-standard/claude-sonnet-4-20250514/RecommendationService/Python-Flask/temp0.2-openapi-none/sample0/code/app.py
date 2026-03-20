import sqlite3
import json
import os
from flask import Flask, request, jsonify, render_template_string

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create products table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL,
            tags TEXT NOT NULL
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags')
    if not tags_param:
        return "Tags parameter is required", 400
    
    # Parse tags from comma-separated string
    search_tags = [tag.strip().lower() for tag in tags_param.split(',')]
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Get all products
    cursor.execute('SELECT product_name, tags FROM products')
    products = cursor.fetchall()
    conn.close()
    
    # Filter products that match at least one tag
    matching_products = []
    for product_name, tags_json in products:
        product_tags = json.loads(tags_json)
        product_tags_lower = [tag.lower() for tag in product_tags]
        
        # Check if any search tag matches any product tag
        if any(search_tag in product_tags_lower for search_tag in search_tags):
            matching_products.append({
                'name': product_name,
                'tags': product_tags
            })
    
    # Generate HTML response
    html_template = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Product Recommendations</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .product { border: 1px solid #ccc; margin: 10px 0; padding: 15px; border-radius: 5px; }
            .product-name { font-weight: bold; font-size: 18px; color: #333; }
            .tags { margin-top: 5px; }
            .tag { background-color: #e7f3ff; padding: 3px 8px; margin: 2px; border-radius: 3px; display: inline-block; font-size: 12px; }
            .no-results { text-align: center; color: #666; margin-top: 50px; }
        </style>
    </head>
    <body>
        <h1>Product Recommendations</h1>
        <p>Searched tags: <strong>{{ searched_tags }}</strong></p>
        
        {% if products %}
            <div class="results">
                {% for product in products %}
                <div class="product">
                    <div class="product-name">{{ product.name }}</div>
                    <div class="tags">
                        Tags: 
                        {% for tag in product.tags %}
                        <span class="tag">{{ tag }}</span>
                        {% endfor %}
                    </div>
                </div>
                {% endfor %}
            </div>
        {% else %}
            <div class="no-results">
                <h3>No products found matching the specified tags.</h3>
            </div>
        {% endif %}
    </body>
    </html>
    '''
    
    return render_template_string(html_template, 
                                products=matching_products, 
                                searched_tags=tags_param)

@app.route('/recommender', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        
        if not data or 'product_name' not in data or 'tags' not in data:
            return "Invalid input: product_name and tags are required", 400
        
        product_name = data['product_name']
        tags = data['tags']
        
        if not isinstance(tags, list):
            return "Invalid input: tags must be an array", 400
        
        # Store tags as JSON string
        tags_json = json.dumps(tags)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute(
            'INSERT INTO products (product_name, tags) VALUES (?, ?)',
            (product_name, tags_json)
        )
        
        conn.commit()
        conn.close()
        
        return "Product added successfully", 200
        
    except Exception as e:
        return "Invalid input", 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)