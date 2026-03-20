<CODE>
from flask import Flask, request, jsonify, render_template_string
import sqlite3
import os
from contextlib import contextmanager
from typing import List, Tuple

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    """Initialize the database with required tables"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_name TEXT NOT NULL
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                tag TEXT NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products(id)
            )
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag)
        ''')
        conn.commit()

def get_products_by_tags(tags: List[str]) -> List[Tuple[str, List[str]]]:
    """Get products that match at least one of the provided tags"""
    if not tags:
        return []
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        placeholders = ','.join('?' * len(tags))
        query = f'''
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            INNER JOIN tags t ON p.id = t.product_id
            WHERE t.tag IN ({placeholders})
        '''
        
        cursor.execute(query, tags)
        products = cursor.fetchall()
        
        result = []
        for product in products:
            product_id = product['id']
            product_name = product['product_name']
            
            # Get all tags for this product
            cursor.execute('SELECT tag FROM tags WHERE product_id = ?', (product_id,))
            product_tags = [row['tag'] for row in cursor.fetchall()]
            
            result.append((product_name, product_tags))
        
        return result

def add_product(product_name: str, tags: List[str]) -> bool:
    """Add a new product with its tags"""
    if not product_name or not tags:
        return False
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Insert product
            cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
            product_id = cursor.lastrowid
            
            # Insert tags
            for tag in tags:
                if tag:  # Only insert non-empty tags
                    cursor.execute('INSERT INTO tags (product_id, tag) VALUES (?, ?)', (product_id, tag))
            
            conn.commit()
            return True
    except Exception:
        return False

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    """Get all posted products that match at least one of the provided tags"""
    try:
        tags_param = request.args.get('tags', '')
        
        if not tags_param:
            return render_template_string('''
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Product Recommendations</title>
                    <meta charset="utf-8">
                </head>
                <body>
                    <h1>Product Recommendations</h1>
                    <p>No tags provided.</p>
                </body>
                </html>
            '''), 200
        
        # Split tags by comma and strip whitespace
        tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
        
        if not tags:
            return render_template_string('''
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Product Recommendations</title>
                    <meta charset="utf-8">
                </head>
                <body>
                    <h1>Product Recommendations</h1>
                    <p>No valid tags provided.</p>
                </body>
                </html>
            '''), 200
        
        products = get_products_by_tags(tags)
        
        # Build HTML response with proper escaping
        html_template = '''
            <!DOCTYPE html>
            <html>
            <head>
                <title>Product Recommendations</title>
                <meta charset="utf-8">
            </head>
            <body>
                <h1>Product Recommendations</h1>
                <p>Searched tags: {{ searched_tags }}</p>
                {% if products %}
                    <ul>
                    {% for product_name, product_tags in products %}
                        <li>
                            <strong>{{ product_name }}</strong>
                            <br>Tags: {{ product_tags|join(', ') }}
                        </li>
                    {% endfor %}
                    </ul>
                {% else %}
                    <p>No products found matching the provided tags.</p>
                {% endif %}
            </body>
            </html>
        '''
        
        response = render_template_string(html_template, 
                                         searched_tags=', '.join(tags),
                                         products=products)
        
        # Add security headers
        headers = {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'self'"
        }
        
        return response, 200, headers
        
    except Exception:
        # Return generic error message without sensitive information
        return render_template_string('''
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error</title>
                <meta charset="utf-8">
            </head>
            <body>
                <h1>Error</h1>
                <p>An error occurred while processing your request.</p>
            </body>
            </html>
        '''), 500

@app.route('/recommender', methods=['POST'])
def post_product():
    """Post a new product along with its tags"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
        
        product_name = data.get('product_name')
        tags = data.get('tags')
        
        # Validate input
        if not product_name or not isinstance(product_name, str):
            return jsonify({'error': 'Invalid input'}), 400
        
        if not tags or not isinstance(tags, list):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Validate all tags are strings
        if not all(isinstance(tag, str) for tag in tags):
            return jsonify({'error': 'Invalid input'}), 400
        
        # Filter out empty tags
        tags = [tag.strip() for tag in tags if tag.strip()]
        
        if not tags:
            return jsonify({'error': 'Invalid input'}), 400
        
        success = add_product(product_name, tags)
        
        if success:
            response = jsonify({'message': 'Product added successfully'})
            # Add security headers
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['X-Frame-Options'] = 'DENY'
            response.headers['Content-Security-Policy'] = "default-src 'self'"
            return response, 200
        else:
            return jsonify({'error': 'Invalid input'}), 400
            
    except Exception:
        # Return generic error message without sensitive information
        return jsonify({'error': 'An error occurred'}), 500

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
</CODE>