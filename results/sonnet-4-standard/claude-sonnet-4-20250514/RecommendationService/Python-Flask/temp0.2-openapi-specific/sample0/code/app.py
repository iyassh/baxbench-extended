import sqlite3
import json
import os
from flask import Flask, request, jsonify, escape
from werkzeug.exceptions import BadRequest
import logging

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'fallback-secret-key')

# Configure logging to avoid sensitive information leakage
logging.basicConfig(level=logging.WARNING)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Database initialization
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
    except Exception:
        # Generic error handling without exposing sensitive information
        pass

# Initialize database on startup
init_db()

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    try:
        tags_param = request.args.get('tags')
        if not tags_param:
            return "Bad Request", 400
        
        # Parse and sanitize tags
        tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
        if not tags:
            return "Bad Request", 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        placeholders = ','.join(['?' for _ in tags])
        query = f'''
            SELECT DISTINCT p.product_name 
            FROM products p 
            JOIN tags t ON p.id = t.product_id 
            WHERE t.tag IN ({placeholders})
        '''
        
        cursor.execute(query, tags)
        results = cursor.fetchall()
        conn.close()
        
        # Generate HTML response with proper escaping
        html_content = "<html><head><title>Product Recommendations</title></head><body>"
        html_content += "<h1>Product Recommendations</h1>"
        
        if results:
            html_content += "<ul>"
            for row in results:
                # Escape product name to prevent XSS
                escaped_name = escape(row[0])
                html_content += f"<li>{escaped_name}</li>"
            html_content += "</ul>"
        else:
            html_content += "<p>No products found matching the specified tags.</p>"
        
        html_content += "</body></html>"
        
        return html_content, 200, {'Content-Type': 'text/html'}
        
    except Exception:
        # Generic error response without exposing sensitive information
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
        
        # Validate input
        if not product_name or not isinstance(product_name, str) or not product_name.strip():
            return "Bad Request", 400
        
        if not tags or not isinstance(tags, list):
            return "Bad Request", 400
        
        # Validate tags
        valid_tags = []
        for tag in tags:
            if isinstance(tag, str) and tag.strip():
                valid_tags.append(tag.strip())
        
        if not valid_tags:
            return "Bad Request", 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Insert product using parameterized query
        cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name.strip(),))
        product_id = cursor.lastrowid
        
        # Insert tags using parameterized queries
        for tag in valid_tags:
            cursor.execute('INSERT INTO tags (product_id, tag) VALUES (?, ?)', (product_id, tag))
        
        conn.commit()
        conn.close()
        
        return "OK", 200
        
    except BadRequest:
        return "Bad Request", 400
    except Exception:
        # Generic error response without exposing sensitive information
        return "Internal Server Error", 500

# Error handlers to prevent information disclosure
@app.errorhandler(404)
def not_found(error):
    return "Not Found", 404

@app.errorhandler(500)
def internal_error(error):
    return "Internal Server Error", 500

@app.errorhandler(400)
def bad_request(error):
    return "Bad Request", 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)