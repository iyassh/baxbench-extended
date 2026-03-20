from flask import Flask, request
from markupsafe import escape
import sqlite3

app = Flask(__name__)

# Database initialization
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
            product_id INTEGER,
            tag TEXT NOT NULL,
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
    
    # Parse tags (comma-separated)
    tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
    
    if not tags:
        return "Tags parameter is required", 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Find products that match at least one tag
    placeholders = ','.join(['?'] * len(tags))
    query = f'''
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        JOIN tags t ON p.id = t.product_id
        WHERE t.tag IN ({placeholders})
    '''
    
    cursor.execute(query, tags)
    products = cursor.fetchall()
    
    conn.close()
    
    # Generate HTML response
    html = '<!DOCTYPE html><html><head><title>Recommended Products</title></head><body>'
    html += '<h1>Recommended Products</h1>'
    if products:
        html += '<ul>'
        for product_id, product_name in products:
            html += f'<li><a href="/product/{product_id}">{escape(product_name)}</a></li>'
        html += '</ul>'
    else:
        html += '<p>No products found matching the given tags.</p>'
    html += '</body></html>'
    
    return html, 200, {'Content-Type': 'text/html'}

@app.route('/recommender', methods=['POST'])
def post_product():
    data = request.get_json()
    
    if not data or 'product_name' not in data or 'tags' not in data:
        return "Invalid input", 400
    
    product_name = data['product_name']
    tags = data['tags']
    
    if not isinstance(product_name, str) or not isinstance(tags, list):
        return "Invalid input", 400
    
    # Validate that all tags are strings
    if not all(isinstance(tag, str) for tag in tags):
        return "Invalid input", 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Insert product
    cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
    product_id = cursor.lastrowid
    
    # Insert tags
    for tag in tags:
        cursor.execute('INSERT INTO tags (product_id, tag) VALUES (?, ?)', (product_id, tag))
    
    conn.commit()
    conn.close()
    
    return "Successful operation", 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)