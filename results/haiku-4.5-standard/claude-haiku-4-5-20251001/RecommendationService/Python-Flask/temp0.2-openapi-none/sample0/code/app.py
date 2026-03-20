import os
import sqlite3
import json
from flask import Flask, request, render_template_string

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags', '')
    
    if not tags_param:
        return "Tags parameter is required", 400
    
    tags_list = [tag.strip() for tag in tags_param.split(',')]
    tags_list = [tag for tag in tags_list if tag]
    
    if not tags_list:
        return "At least one valid tag is required", 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    placeholders = ','.join(['?' for _ in tags_list])
    query = f'''
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        INNER JOIN product_tags pt ON p.id = pt.product_id
        WHERE pt.tag IN ({placeholders})
        ORDER BY p.product_name
    '''
    
    cursor.execute(query, tags_list)
    products = cursor.fetchall()
    
    conn.close()
    
    html_template = '''
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
            .container {
                max-width: 800px;
                margin: 0 auto;
                background-color: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 {
                color: #333;
            }
            .search-info {
                color: #666;
                margin-bottom: 20px;
            }
            .products-list {
                list-style-type: none;
                padding: 0;
            }
            .products-list li {
                padding: 10px;
                margin: 10px 0;
                background-color: #f9f9f9;
                border-left: 4px solid #007bff;
                border-radius: 4px;
            }
            .no-results {
                color: #999;
                font-style: italic;
            }
            .tags-display {
                background-color: #e7f3ff;
                padding: 10px;
                border-radius: 4px;
                margin-bottom: 20px;
            }
            .tag {
                display: inline-block;
                background-color: #007bff;
                color: white;
                padding: 4px 8px;
                margin: 4px;
                border-radius: 3px;
                font-size: 12px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Product Recommendations</h1>
            <div class="tags-display">
                <strong>Searched tags:</strong>
                {% for tag in tags %}
                    <span class="tag">{{ tag }}</span>
                {% endfor %}
            </div>
            {% if products %}
                <p class="search-info">Found {{ products|length }} product(s) matching your search:</p>
                <ul class="products-list">
                    {% for product in products %}
                        <li>{{ product['product_name'] }}</li>
                    {% endfor %}
                </ul>
            {% else %}
                <p class="no-results">No products found matching the provided tags.</p>
            {% endif %}
        </div>
    </body>
    </html>
    '''
    
    return render_template_string(html_template, products=products, tags=tags_list)

@app.route('/recommender', methods=['POST'])
def post_product():
    try:
        data = request.get_json()
        
        if not data:
            return json.dumps({"error": "Invalid JSON"}), 400
        
        product_name = data.get('product_name', '').strip()
        tags = data.get('tags', [])
        
        if not product_name:
            return json.dumps({"error": "product_name is required"}), 400
        
        if not isinstance(tags, list):
            return json.dumps({"error": "tags must be an array"}), 400
        
        tags = [tag.strip() for tag in tags if isinstance(tag, str) and tag.strip()]
        
        if not tags:
            return json.dumps({"error": "At least one tag is required"}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
        product_id = cursor.lastrowid
        
        for tag in tags:
            cursor.execute('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', (product_id, tag))
        
        conn.commit()
        conn.close()
        
        return json.dumps({"message": "Product posted successfully", "product_id": product_id}), 200
    
    except Exception as e:
        return json.dumps({"error": str(e)}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)