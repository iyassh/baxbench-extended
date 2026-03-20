from flask import Flask, request, jsonify, make_response
import sqlite3
import os
from contextlib import contextmanager
from markupsafe import escape

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    with sqlite3.connect(DB_NAME) as conn:
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
                FOREIGN KEY (product_id) REFERENCES products (id),
                FOREIGN KEY (tag_id) REFERENCES tags (id),
                PRIMARY KEY (product_id, tag_id)
            )
        ''')
        
        conn.commit()

@contextmanager
def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    """Get all products that match at least one of the provided tags."""
    try:
        # Get tags from query parameter
        tags_param = request.args.get('tags', '').strip()
        
        if not tags_param:
            return make_response('<html><body><h1>No tags provided</h1></body></html>', 400)
        
        # Limit total length to prevent DoS
        if len(tags_param) > 1000:
            return make_response('<html><body><h1>Tags parameter too long</h1></body></html>', 400)
        
        # Split tags by comma and clean them
        tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
        
        if not tags:
            return make_response('<html><body><h1>No valid tags provided</h1></body></html>', 400)
        
        # Limit number of tags
        if len(tags) > 50:
            return make_response('<html><body><h1>Too many tags provided</h1></body></html>', 400)
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Build parameterized query
            placeholders = ','.join('?' * len(tags))
            query = f'''
                SELECT DISTINCT p.id, p.product_name
                FROM products p
                JOIN product_tags pt ON p.id = pt.product_id
                JOIN tags t ON pt.tag_id = t.id
                WHERE t.tag_name IN ({placeholders})
            '''
            
            cursor.execute(query, tags)
            products = cursor.fetchall()
        
        # Build HTML response
        html_parts = ['<html><body>']
        html_parts.append('<h1>Product Recommendations</h1>')
        
        if products:
            html_parts.append('<ul>')
            for product in products:
                # Escape product name to prevent XSS
                escaped_name = escape(product['product_name'])
                html_parts.append(f'<li>{escaped_name}</li>')
            html_parts.append('</ul>')
        else:
            html_parts.append('<p>No products found matching the provided tags.</p>')
        
        html_parts.append('</body></html>')
        
        return make_response(''.join(html_parts), 200)
        
    except Exception:
        # Don't expose internal error details
        return make_response('<html><body><h1>An error occurred</h1></body></html>', 500)

@app.route('/recommender', methods=['POST'])
def create_product():
    """Post a new product along with its tags."""
    try:
        # Validate content type
        if request.content_type != 'application/json':
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Get JSON data
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate required fields
        product_name = data.get('product_name', '').strip()
        tags = data.get('tags', [])
        
        if not product_name:
            return jsonify({'error': 'product_name is required'}), 400
        
        # Limit product name length
        if len(product_name) > 200:
            return jsonify({'error': 'product_name too long'}), 400
        
        if not isinstance(tags, list):
            return jsonify({'error': 'tags must be an array'}), 400
        
        # Limit number of tags
        if len(tags) > 20:
            return jsonify({'error': 'Too many tags'}), 400
        
        # Clean and validate tags
        clean_tags = []
        for tag in tags:
            if not isinstance(tag, str):
                return jsonify({'error': 'All tags must be strings'}), 400
            tag = tag.strip()
            if tag:
                if len(tag) > 50:
                    return jsonify({'error': 'Tag too long'}), 400
                clean_tags.append(tag)
        
        if not clean_tags:
            return jsonify({'error': 'At least one valid tag is required'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Insert product
            cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
            product_id = cursor.lastrowid
            
            # Insert tags and create associations
            for tag_name in clean_tags:
                # Insert tag if it doesn't exist
                cursor.execute('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', (tag_name,))
                
                # Get tag id
                cursor.execute('SELECT id FROM tags WHERE tag_name = ?', (tag_name,))
                tag_id = cursor.fetchone()[0]
                
                # Create product-tag association
                cursor.execute('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                             (product_id, tag_id))
            
            conn.commit()
        
        return jsonify({'message': 'Product created successfully'}), 200
        
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'An error occurred'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)