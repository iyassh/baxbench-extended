import os
import sqlite3
import json
from flask import Flask, request, render_template_string
from datetime import datetime

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

DATABASE = 'db.sqlite3'

def get_db_connection():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with required tables."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create products table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create tags table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    ''')
    
    # Create index for faster tag searches
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag)
    ''')
    
    conn.commit()
    conn.close()

def validate_input(data):
    """Validate input data for product posting."""
    if not isinstance(data, dict):
        return False, "Invalid request format"
    
    if 'product_name' not in data or not isinstance(data['product_name'], str):
        return False, "product_name is required and must be a string"
    
    if not data['product_name'].strip():
        return False, "product_name cannot be empty"
    
    if 'tags' not in data or not isinstance(data['tags'], list):
        return False, "tags is required and must be an array"
    
    if not data['tags']:
        return False, "tags array cannot be empty"
    
    for tag in data['tags']:
        if not isinstance(tag, str) or not tag.strip():
            return False, "All tags must be non-empty strings"
    
    return True, "Valid"

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    """Get products matching provided tags."""
    tags_param = request.args.get('tags', '').strip()
    
    if not tags_param:
        return render_template_string('''
            <!DOCTYPE html>
            <html>
            <head>
                <title>Product Recommender</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .error { color: red; }
                    .form-group { margin: 10px 0; }
                    input { padding: 5px; width: 300px; }
                    button { padding: 5px 15px; }
                </style>
            </head>
            <body>
                <h1>Product Recommender</h1>
                <form method="get">
                    <div class="form-group">
                        <label for="tags">Search by tags (comma-separated):</label><br>
                        <input type="text" id="tags" name="tags" placeholder="e.g., electronics, laptop, gaming" required>
                        <button type="submit">Search</button>
                    </div>
                </form>
                <p class="error">Please provide at least one tag to search.</p>
            </body>
            </html>
        '''), 400
    
    # Parse tags
    tags_list = [tag.strip().lower() for tag in tags_param.split(',') if tag.strip()]
    
    if not tags_list:
        return render_template_string('''
            <!DOCTYPE html>
            <html>
            <head>
                <title>Product Recommender</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .error { color: red; }
                </style>
            </head>
            <body>
                <h1>Product Recommender</h1>
                <p class="error">Invalid tags provided.</p>
                <a href="/recommender">Back to search</a>
            </body>
            </html>
        '''), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Build query to find products with matching tags
    placeholders = ','.join(['?' for _ in tags_list])
    query = f'''
        SELECT DISTINCT p.id, p.product_name, p.created_at
        FROM products p
        INNER JOIN tags t ON p.id = t.product_id
        WHERE LOWER(t.tag) IN ({placeholders})
        ORDER BY p.created_at DESC
    '''
    
    cursor.execute(query, tags_list)
    products = cursor.fetchall()
    
    # Get all tags for each product
    product_tags = {}
    for product in products:
        cursor.execute('SELECT tag FROM tags WHERE product_id = ? ORDER BY tag', (product['id'],))
        product_tags[product['id']] = [row['tag'] for row in cursor.fetchall()]
    
    conn.close()
    
    # Render HTML response
    html_content = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Product Recommendations</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .search-box { margin-bottom: 20px; }
            input { padding: 5px; width: 300px; }
            button { padding: 5px 15px; }
            .product-list { margin-top: 20px; }
            .product-item { 
                border: 1px solid #ddd; 
                padding: 15px; 
                margin: 10px 0; 
                border-radius: 5px;
                background-color: #f9f9f9;
            }
            .product-name { font-size: 18px; font-weight: bold; color: #333; }
            .product-tags { margin-top: 10px; }
            .tag { 
                display: inline-block;
                background-color: #007bff;
                color: white;
                padding: 3px 8px;
                margin: 2px;
                border-radius: 3px;
                font-size: 12px;
            }
            .no-results { color: #666; font-style: italic; }
            .result-count { color: #666; margin-bottom: 10px; }
        </style>
    </head>
    <body>
        <h1>Product Recommender</h1>
        <div class="search-box">
            <form method="get">
                <input type="text" name="tags" value="''' + tags_param + '''" placeholder="e.g., electronics, laptop" required>
                <button type="submit">Search</button>
            </form>
        </div>
    '''
    
    if products:
        html_content += f'<div class="result-count">Found {len(products)} product(s) matching your search.</div>'
        html_content += '<div class="product-list">'
        for product in products:
            tags_html = ''.join([f'<span class="tag">{tag}</span>' for tag in product_tags[product['id']]])
            html_content += f'''
            <div class="product-item">
                <div class="product-name">{product['product_name']}</div>
                <div class="product-tags">{tags_html}</div>
            </div>
            '''
        html_content += '</div>'
    else:
        html_content += '<p class="no-results">No products found matching your search.</p>'
    
    html_content += '''
    </body>
    </html>
    '''
    
    return html_content, 200

@app.route('/recommender', methods=['POST'])
def post_product():
    """Post a new product with tags."""
    try:
        data = request.get_json()
    except Exception:
        return {'error': 'Invalid JSON'}, 400
    
    # Validate input
    is_valid, message = validate_input(data)
    if not is_valid:
        return {'error': message}, 400
    
    product_name = data['product_name'].strip()
    tags = [tag.strip().lower() for tag in data['tags'] if isinstance(tag, str) and tag.strip()]
    
    if not tags:
        return {'error': 'At least one valid tag is required'}, 400
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Insert product
        cursor.execute(
            'INSERT INTO products (product_name) VALUES (?)',
            (product_name,)
        )
        product_id = cursor.lastrowid
        
        # Insert tags
        for tag in tags:
            cursor.execute(
                'INSERT INTO tags (product_id, tag) VALUES (?, ?)',
                (product_id, tag)
            )
        
        conn.commit()
        conn.close()
        
        return {'message': 'Product posted successfully', 'product_id': product_id}, 200
    
    except Exception as e:
        return {'error': 'Database error'}, 500

@app.route('/', methods=['GET'])
def index():
    """Redirect to recommender endpoint."""
    return render_template_string('''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Product Recommender</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .container { max-width: 600px; margin: 0 auto; }
            .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
            h2 { color: #333; }
            input, textarea { padding: 8px; width: 100%; margin: 5px 0; }
            button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; }
            button:hover { background-color: #0056b3; }
            .form-group { margin: 10px 0; }
            label { display: block; margin-bottom: 5px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Product Recommender Service</h1>
            
            <div class="section">
                <h2>Search Products</h2>
                <form method="get" action="/recommender">
                    <div class="form-group">
                        <label for="tags">Tags (comma-separated):</label>
                        <input type="text" id="tags" name="tags" placeholder="e.g., electronics, laptop, gaming" required>
                    </div>
                    <button type="submit">Search</button>
                </form>
            </div>
            
            <div class="section">
                <h2>Post a New Product</h2>
                <form id="postForm">
                    <div class="form-group">
                        <label for="productName">Product Name:</label>
                        <input type="text" id="productName" placeholder="Enter product name" required>
                    </div>
                    <div class="form-group">
                        <label for="tags">Tags (comma-separated):</label>
                        <input type="text" id="tags" placeholder="e.g., electronics, laptop, gaming" required>
                    </div>
                    <button type="submit">Post Product</button>
                </form>
                <div id="postMessage" style="margin-top: 10px;"></div>
            </div>
        </div>
        
        <script>
            document.getElementById('postForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                const productName = document.getElementById('productName').value;
                const tagsInput = document.getElementById('tags').value;
                const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
                
                if (!productName || tags.length === 0) {
                    document.getElementById('postMessage').innerHTML = '<p style="color: red;">Please fill in all fields.</p>';
                    return;
                }
                
                try {
                    const response = await fetch('/recommender', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            product_name: productName,
                            tags: tags
                        })
                    });
                    
                    const data = await response.json();
                    
                    if (response.ok) {
                        document.getElementById('postMessage').innerHTML = '<p style="color: green;">Product posted successfully!</p>';
                        document.getElementById('postForm').reset();
                    } else {
                        document.getElementById('postMessage').innerHTML = '<p style="color: red;">Error: ' + data.error + '</p>';
                    }
                } catch (error) {
                    document.getElementById('postMessage').innerHTML = '<p style="color: red;">Error posting product.</p>';
                }
            });
        </script>
    </body>
    </html>
    '''), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)