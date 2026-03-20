import sqlite3
import json
import os
from flask import Flask, request, jsonify, render_template_string
from werkzeug.exceptions import BadRequest

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
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
    search_tags = [tag.strip().lower() for tag in tags_param.split(',') if tag.strip()]
    if not search_tags:
        return "At least one valid tag is required", 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Build query to find products matching any of the tags
    placeholders = ','.join(['?' for _ in search_tags])
    query = f'''
        SELECT DISTINCT product_name, tags 
        FROM products 
        WHERE id IN (
            SELECT id FROM products 
            WHERE tags LIKE '%' || ? || '%'
            {' OR tags LIKE "%" || ? || "%" ' * (len(search_tags) - 1)}
        )
    '''
    
    cursor.execute(query, search_tags)
    results = cursor.fetchall()
    conn.close()
    
    # Generate HTML response
    html_template = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Product Recommendations</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .product { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
            .product-name { font-weight: bold; font-size: 18px; color: #333; }
            .tags { color: #666; margin-top: 5px; }
            .no-results { color: #999; font-style: italic; }
        </style>
    </head>
    <body>
        <h1>Product Recommendations</h1>
        <p>Searched tags: {{ searched_tags }}</p>
        {% if products %}
            {% for product in products %}
            <div class="product">
                <div class="product-name">{{ product[0] }}</div>
                <div class="tags">Tags: {{ product[1] }}</div>
            </div>
            {% endfor %}
        {% else %}
            <div class="no-results">No products found matching the specified tags.</div>
        {% endif %}
    </body>
    </html>
    '''
    
    return render_template_string(html_template, 
                                products=results, 
                                searched_tags=', '.join(search_tags))

@app.route('/recommender', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        product_name = data.get('product_name')
        tags = data.get('tags')
        
        if not product_name:
            return jsonify({"error": "product_name is required"}), 400
        
        if not tags or not isinstance(tags, list):
            return jsonify({"error": "tags must be a non-empty array"}), 400
        
        # Validate that all tags are strings
        for tag in tags:
            if not isinstance(tag, str):
                return jsonify({"error": "All tags must be strings"}), 400
        
        # Convert tags to lowercase and join with commas for storage
        tags_str = ','.join([tag.strip().lower() for tag in tags if tag.strip()])
        
        if not tags_str:
            return jsonify({"error": "At least one valid tag is required"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO products (product_name, tags) VALUES (?, ?)',
            (product_name, tags_str)
        )
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Product added successfully"}), 200
        
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)