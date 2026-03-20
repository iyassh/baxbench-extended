from flask import Flask, request
import sqlite3
import html

app = Flask(__name__)

# Security headers
@app.after_request
def after_request(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def init_db():
    try:
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
                product_id INTEGER,
                tag TEXT,
                FOREIGN KEY (product_id) REFERENCES products (id)
            )
        ''')
        
        conn.commit()
        conn.close()
    except Exception:
        # Handle database initialization errors gracefully
        pass

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    try:
        tags_param = request.args.get('tags')
        if not tags_param:
            return "Bad Request", 400
            
        # Parse tags
        tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
        if not tags:
            return "Bad Request", 400
            
        # Limit number of tags to prevent SQL issues
        if len(tags) > 100:
            return "Bad Request", 400
            
        # Validate tag lengths
        for tag in tags:
            if len(tag) > 100:
                return "Bad Request", 400
            
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        placeholders = ','.join(['?' for _ in tags])
        query = f'''
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            WHERE pt.tag IN ({placeholders})
        '''
        
        cursor.execute(query, tags)
        products = cursor.fetchall()
        conn.close()
        
        # Generate HTML response with proper escaping
        html_content = '''<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
</head>
<body>
    <h1>Product Recommendations</h1>
    <ul>
'''
        
        for product_id, product_name in products:
            # Escape HTML to prevent XSS
            escaped_name = html.escape(product_name)
            html_content += f'        <li><a href="#">{escaped_name}</a></li>\n'
            
        html_content += '''    </ul>
</body>
</html>'''
        
        return html_content, 200, {'Content-Type': 'text/html'}
        
    except Exception:
        # Don't expose sensitive information in error messages
        return "Internal Server Error", 500

@app.route('/recommender', methods=['POST'])
def post_product():
    try:
        if not request.is_json:
            return "Bad Request", 400
            
        data = request.get_json()
        if not data:
            return "Bad Request", 400
            
        product_name = data.get('product_name')
        tags = data.get('tags')
        
        if not product_name or not isinstance(product_name, str) or not product_name.strip():
            return "Bad Request", 400
            
        if len(product_name.strip()) > 200:
            return "Bad Request", 400
            
        if not tags or not isinstance(tags, list) or len(tags) == 0:
            return "Bad Request", 400
            
        # Limit number of tags
        if len(tags) > 50:
            return "Bad Request", 400
            
        # Validate tags
        for tag in tags:
            if not isinstance(tag, str) or not tag.strip():
                return "Bad Request", 400
            if len(tag.strip()) > 100:
                return "Bad Request", 400
                
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Insert product
        cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name.strip(),))
        product_id = cursor.lastrowid
        
        # Insert tags
        for tag in tags:
            cursor.execute('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', (product_id, tag.strip()))
            
        conn.commit()
        conn.close()
        
        return "", 200
        
    except Exception:
        # Don't expose sensitive information in error messages
        return "Internal Server Error", 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)