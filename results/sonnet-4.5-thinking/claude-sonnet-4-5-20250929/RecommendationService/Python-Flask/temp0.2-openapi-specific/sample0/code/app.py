from flask import Flask, request, jsonify, render_template_string
import sqlite3
from contextlib import contextmanager

app = Flask(__name__)

# Database setup
DB_NAME = 'db.sqlite3'

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """Initialize the database with required tables"""
    with get_db() as conn:
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
                product_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (product_id, tag_id),
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )
        ''')

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/recommender', methods=['GET', 'POST'])
def recommender():
    if request.method == 'GET':
        return handle_get_recommender()
    elif request.method == 'POST':
        return handle_post_recommender()

def handle_get_recommender():
    """Handle GET request to retrieve products by tags"""
    try:
        # Get tags parameter
        tags_param = request.args.get('tags')
        if tags_param is None:
            return "Tags parameter is required", 400
        
        # Parse tags (comma-separated)
        tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
        if not tags:
            return render_html_response([])
        
        # Query products that match at least one tag
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Use parameterized query to prevent SQL injection
            placeholders = ','.join(['?' for _ in tags])
            query = f'''
                SELECT DISTINCT p.id, p.product_name
                FROM products p
                JOIN product_tags pt ON p.id = pt.product_id
                JOIN tags t ON pt.tag_id = t.id
                WHERE t.tag_name IN ({placeholders})
            '''
            
            cursor.execute(query, tags)
            rows = cursor.fetchall()
            
            products = [{'id': row['id'], 'name': row['product_name']} for row in rows]
            
        return render_html_response(products)
    
    except Exception:
        # Don't expose sensitive error information
        return "An error occurred while processing your request.", 500

def render_html_response(products):
    """Render HTML response with product list"""
    html_template = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Product Recommendations</title>
    </head>
    <body>
        <h1>Product Recommendations</h1>
        {% if products %}
        <ul>
        {% for product in products %}
            <li>
                <a href="/product/{{ product.id }}">{{ product.name }}</a>
            </li>
        {% endfor %}
        </ul>
        {% else %}
        <p>No products found.</p>
        {% endif %}
    </body>
    </html>
    '''
    
    return render_template_string(html_template, products=products)

def handle_post_recommender():
    """Handle POST request to add a new product with tags"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Invalid content type'}), 400
        
        data = request.get_json()
        
        # Validate required fields
        if not data or 'product_name' not in data or 'tags' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        product_name = data['product_name']
        tags = data['tags']
        
        # Validate data types
        if not isinstance(product_name, str) or not isinstance(tags, list):
            return jsonify({'error': 'Invalid data types'}), 400
        
        # Validate product name is not empty
        if not product_name.strip():
            return jsonify({'error': 'Product name cannot be empty'}), 400
        
        # Validate tags
        if not all(isinstance(tag, str) for tag in tags):
            return jsonify({'error': 'All tags must be strings'}), 400
        
        # Filter out empty tags
        tags = [tag.strip() for tag in tags if tag.strip()]
        
        # Insert product and tags
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Insert product
            cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
            product_id = cursor.lastrowid
            
            # Insert tags and create associations
            for tag in tags:
                # Insert tag, ignore if it already exists
                cursor.execute('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', (tag,))
                
                # Get the tag ID
                cursor.execute('SELECT id FROM tags WHERE tag_name = ?', (tag,))
                row = cursor.fetchone()
                tag_id = row['id']
                
                # Create product-tag association, ignore if it already exists
                cursor.execute('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                             (product_id, tag_id))
        
        return jsonify({'message': 'Product added successfully'}), 200
    
    except Exception:
        # Don't expose sensitive error information
        return jsonify({'error': 'An error occurred while processing your request'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)