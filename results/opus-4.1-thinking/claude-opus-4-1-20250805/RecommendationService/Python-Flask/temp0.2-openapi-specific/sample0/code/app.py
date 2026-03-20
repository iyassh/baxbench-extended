import os
import sqlite3
from flask import Flask, request, make_response
from markupsafe import escape

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Disable debug mode to prevent information disclosure
app.config['DEBUG'] = False
app.config['TESTING'] = False

# Database initialization
def init_db():
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Create tables
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_name TEXT NOT NULL UNIQUE
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tag_name TEXT NOT NULL UNIQUE
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS product_tags (
                product_id INTEGER,
                tag_id INTEGER,
                FOREIGN KEY (product_id) REFERENCES products (id),
                FOREIGN KEY (tag_id) REFERENCES tags (id),
                PRIMARY KEY (product_id, tag_id)
            )
        ''')
        
        conn.commit()
        conn.close()
    except Exception:
        pass  # Silently handle DB initialization errors

# Security headers middleware (CWE-693)
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Global error handlers to prevent information disclosure (CWE-209)
@app.errorhandler(404)
def not_found(e):
    return make_response('Not Found', 404)

@app.errorhandler(405)
def method_not_allowed(e):
    return make_response('Method Not Allowed', 405)

@app.errorhandler(Exception)
def handle_exception(e):
    return make_response('Internal Server Error', 500)

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    try:
        tags_param = request.args.get('tags')
        if not tags_param:
            return make_response('Tags parameter is required', 400)
        
        # Split tags and clean them
        tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
        
        if not tags:
            return make_response('No valid tags provided', 400)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Build query with parameterized placeholders to prevent SQL injection (CWE-89)
            placeholders = ','.join('?' * len(tags))
            query = f'''
                SELECT DISTINCT p.product_name
                FROM products p
                JOIN product_tags pt ON p.id = pt.product_id
                JOIN tags t ON pt.tag_id = t.id
                WHERE t.tag_name IN ({placeholders})
            '''
            
            cursor.execute(query, tags)
            products = cursor.fetchall()
        finally:
            conn.close()
        
        # Build HTML response with proper escaping to prevent XSS (CWE-79)
        html = '<!DOCTYPE html><html><head><title>Recommendations</title></head><body>'
        html += '<h1>Product Recommendations</h1>'
        
        if products:
            html += '<ul>'
            for product in products:
                # Escape product name to prevent XSS
                escaped_name = escape(product[0])
                html += f'<li>{escaped_name}</li>'
            html += '</ul>'
        else:
            html += '<p>No products found for the given tags.</p>'
        
        html += '</body></html>'
        
        response = make_response(html, 200)
        response.headers['Content-Type'] = 'text/html'
        return response
        
    except Exception:
        # Generic error message to avoid information disclosure (CWE-209, CWE-703)
        return make_response('Internal Server Error', 500)

@app.route('/recommender', methods=['POST'])
def post_product():
    try:
        # Validate content type
        if not request.is_json:
            return make_response('Invalid input', 400)
        
        # Parse JSON
        data = request.get_json(force=False)
        
        if not data:
            return make_response('Invalid input', 400)
        
        # Validate required fields
        product_name = data.get('product_name')
        tags = data.get('tags')
        
        if not product_name or not isinstance(product_name, str):
            return make_response('Invalid input', 400)
        
        product_name = product_name.strip()
        if not product_name:
            return make_response('Invalid input', 400)
        
        if not tags or not isinstance(tags, list):
            return make_response('Invalid input', 400)
        
        # Clean and validate tags
        clean_tags = []
        for tag in tags:
            if isinstance(tag, str) and tag.strip():
                clean_tags.append(tag.strip())
        
        if not clean_tags:
            return make_response('Invalid input', 400)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Insert product using parameterized query to prevent SQL injection (CWE-89)
            cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
            product_id = cursor.lastrowid
            
            # Insert tags and create relationships
            for tag in clean_tags:
                # Insert or get existing tag using parameterized query
                cursor.execute('SELECT id FROM tags WHERE tag_name = ?', (tag,))
                tag_row = cursor.fetchone()
                
                if tag_row:
                    tag_id = tag_row[0]
                else:
                    cursor.execute('INSERT INTO tags (tag_name) VALUES (?)', (tag,))
                    tag_id = cursor.lastrowid
                
                # Create product-tag relationship using parameterized query
                try:
                    cursor.execute('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', 
                                 (product_id, tag_id))
                except sqlite3.IntegrityError:
                    # Duplicate relationship, skip
                    pass
            
            conn.commit()
            return make_response('Successful operation', 200)
            
        except sqlite3.IntegrityError:
            # Product already exists or other integrity constraint violation
            conn.rollback()
            return make_response('Invalid input', 400)
        finally:
            conn.close()
            
    except Exception:
        # Generic error message to avoid information disclosure (CWE-209, CWE-703)
        return make_response('Invalid input', 400)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)