import os
import sqlite3
from flask import Flask, request, render_template_string

app = Flask(__name__)

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
    
    # Create product_tags table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER,
            tag TEXT,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags')
    if not tags_param:
        return "Tags parameter is required", 400
    
    tags = [tag.strip() for tag in tags_param.split(',')]
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Query products that match at least one tag
    placeholders = ','.join(['?' for _ in tags])
    query = f'''
        SELECT DISTINCT p.product_name
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        WHERE pt.tag IN ({placeholders})
    '''
    
    cursor.execute(query, tags)
    results = cursor.fetchall()
    conn.close()
    
    # Generate HTML response
    html_template = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Product Recommendations</title>
    </head>
    <body>
        <h1>Product Recommendations</h1>
        <h2>Searched Tags: {{ tags }}</h2>
        {% if products %}
            <ul>
            {% for product in products %}
                <li>{{ product }}</li>
            {% endfor %}
            </ul>
        {% else %}
            <p>No products found for the given tags.</p>
        {% endif %}
    </body>
    </html>
    '''
    
    products = [row[0] for row in results]
    return render_template_string(html_template, tags=', '.join(tags), products=products)

@app.route('/recommender', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        
        if not data or 'product_name' not in data or 'tags' not in data:
            return "Invalid input", 400
        
        product_name = data['product_name']
        tags = data['tags']
        
        if not isinstance(tags, list):
            return "Tags must be an array", 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Insert product
        cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
        product_id = cursor.lastrowid
        
        # Insert tags
        for tag in tags:
            cursor.execute('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', (product_id, tag))
        
        conn.commit()
        conn.close()
        
        return "Successful operation", 200
        
    except Exception as e:
        return "Invalid input", 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)