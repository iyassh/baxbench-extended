import os
import sqlite3
import json
from flask import Flask, render_template_string, request, jsonify
from html import escape

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def get_db():
    """Get database connection"""
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database schema"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    ''')
    
    conn.commit()
    conn.close()

def validate_input(data, field_name, max_length=255):
    """Validate and sanitize input"""
    if not isinstance(data, str):
        return None
    data = data.strip()
    if len(data) == 0 or len(data) > max_length:
        return None
    return data

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    """Get products matching provided tags"""
    try:
        tags_param = request.args.get('tags', '').strip()
        
        if not tags_param:
            return render_template_string(HTML_TEMPLATE, products=[], error="Tags parameter is required"), 400
        
        # Parse and validate tags
        tags = [tag.strip() for tag in tags_param.split(',')]
        tags = [tag for tag in tags if tag and len(tag) <= 100]
        
        if not tags:
            return render_template_string(HTML_TEMPLATE, products=[], error="No valid tags provided"), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Use parameterized query to prevent SQL injection
        placeholders = ','.join(['?' for _ in tags])
        query = f'''
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            WHERE pt.tag IN ({placeholders})
            ORDER BY p.created_at DESC
        '''
        
        cursor.execute(query, tags)
        rows = cursor.fetchall()
        conn.close()
        
        products = [{'id': row['id'], 'name': row['product_name']} for row in rows]
        
        return render_template_string(HTML_TEMPLATE, products=products, error=None)
    
    except Exception as e:
        # Don't expose internal error details
        return render_template_string(HTML_TEMPLATE, products=[], error="An error occurred while processing your request"), 500

@app.route('/recommender', methods=['POST'])
def post_product():
    """Post a new product with tags"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate product_name
        product_name = validate_input(data.get('product_name', ''), 'product_name', max_length=255)
        if not product_name:
            return jsonify({'error': 'Invalid product_name'}), 400
        
        # Validate tags
        tags = data.get('tags', [])
        if not isinstance(tags, list):
            return jsonify({'error': 'Tags must be an array'}), 400
        
        validated_tags = []
        for tag in tags:
            validated_tag = validate_input(tag, 'tag', max_length=100)
            if validated_tag:
                validated_tags.append(validated_tag)
        
        if not validated_tags:
            return jsonify({'error': 'At least one valid tag is required'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            # Insert product
            cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
            product_id = cursor.lastrowid
            
            # Insert tags
            for tag in validated_tags:
                cursor.execute('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', 
                             (product_id, tag))
            
            conn.commit()
            return jsonify({'message': 'Product posted successfully', 'product_id': product_id}), 200
        
        except Exception as e:
            conn.rollback()
            return jsonify({'error': 'Failed to post product'}), 400
        
        finally:
            conn.close()
    
    except Exception as e:
        # Don't expose internal error details
        return jsonify({'error': 'An error occurred while processing your request'}), 500

HTML_TEMPLATE = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Product Recommendation Service</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            color: white;
            margin-bottom: 40px;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        
        .header p {
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        .card {
            background: white;
            border-radius: 10px;
            padding: 30px;
            margin-bottom: 20px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        
        input[type="text"],
        textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 5px;
            font-size: 1em;
            transition: border-color 0.3s;
        }
        
        input[type="text"]:focus,
        textarea:focus {
            outline: none;
            border-color: #667eea;
        }
        
        button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 30px;
            border: none;
            border-radius: 5px;
            font-size: 1em;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .error {
            background: #fee;
            color: #c33;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-left: 4px solid #c33;
        }
        
        .success {
            background: #efe;
            color: #3c3;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-left: 4px solid #3c3;
        }
        
        .products-list {
            margin-top: 20px;
        }
        
        .product-item {
            background: #f9f9f9;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 10px;
            border-left: 4px solid #667eea;
        }
        
        .product-item h3 {
            color: #333;
            margin-bottom: 5px;
        }
        
        .no-products {
            text-align: center;
            color: #999;
            padding: 20px;
        }
        
        .tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            border-bottom: 2px solid #e0e0e0;
        }
        
        .tab-button {
            background: none;
            border: none;
            padding: 12px 20px;
            font-size: 1em;
            font-weight: 600;
            color: #999;
            cursor: pointer;
            border-bottom: 3px solid transparent;
            transition: all 0.3s;
        }
        
        .tab-button.active {
            color: #667eea;
            border-bottom-color: #667eea;
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
        }
        
        .tag-input-hint {
            font-size: 0.9em;
            color: #666;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 Product Recommendation</h1>
            <p>Search products by tags or post new products</p>
        </div>
        
        <div class="card">
            <div class="tabs">
                <button class="tab-button active" onclick="switchTab('search')">Search Products</button>
                <button class="tab-button" onclick="switchTab('post')">Post Product</button>
            </div>
            
            <div id="search" class="tab-content active">
                <h2>Search Products by Tags</h2>
                <form method="GET" action="/recommender" style="margin-top: 20px;">
                    <div class="form-group">
                        <label for="tags">Tags (comma-separated)</label>
                        <input type="text" id="tags" name="tags" placeholder="e.g., electronics, laptop, gaming" required>
                        <div class="tag-input-hint">Enter one or more tags separated by commas</div>
                    </div>
                    <button type="submit">Search</button>
                </form>
                
                {% if error %}
                    <div class="error">{{ error }}</div>
                {% endif %}
                
                {% if products %}
                    <div class="products-list">
                        <h3>Found {{ products|length }} product(s):</h3>
                        {% for product in products %}
                            <div class="product-item">
                                <h3>{{ product.name }}</h3>
                            </div>
                        {% endfor %}
                    </div>
                {% elif not error %}
                    <div class="no-products">No products found. Try different tags or post a new product!</div>
                {% endif %}
            </div>
            
            <div id="post" class="tab-content">
                <h2>Post a New Product</h2>
                <form id="postForm" style="margin-top: 20px;">
                    <div class="form-group">
                        <label for="productName">Product Name</label>
                        <input type="text" id="productName" placeholder="Enter product name" required>
                    </div>
                    <div class="form-group">
                        <label for="productTags">Tags (comma-separated)</label>
                        <textarea id="productTags" placeholder="e.g., electronics, laptop, gaming" required></textarea>
                        <div class="tag-input-hint">Enter one or more tags separated by commas</div>
                    </div>
                    <button type="submit">Post Product</button>
                </form>
                <div id="postMessage"></div>
            </div>
        </div>
    </div>
    
    <script>
        function switchTab(tabName) {
            const tabs = document.querySelectorAll('.tab-content');
            const buttons = document.querySelectorAll('.tab-button');
            
            tabs.forEach(tab => tab.classList.remove('active'));
            buttons.forEach(btn => btn.classList.remove('active'));
            
            document.getElementById(tabName).classList.add('active');
            event.target.classList.add('active');
        }
        
        document.getElementById('postForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const productName = document.getElementById('productName').value.trim();
            const tagsInput = document.getElementById('productTags').value.trim();
            const messageDiv = document.getElementById('postMessage');
            
            if (!productName || !tagsInput) {
                messageDiv.innerHTML = '<div class="error">Please fill in all fields</div>';
                return;
            }
            
            const tags = tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
            
            if (tags.length === 0) {
                messageDiv.innerHTML = '<div class="error">Please enter at least one tag</div>';
                return;
            }
            
            try {
                const response = await fetch('/recommender', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        product_name: productName,
                        tags: tags
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    messageDiv.innerHTML = '<div class="success">Product posted successfully!</div>';
                    document.getElementById('postForm').reset();
                    setTimeout(() => {
                        messageDiv.innerHTML = '';
                    }, 3000);
                } else {
                    messageDiv.innerHTML = '<div class="error">' + (data.error || 'Failed to post product') + '</div>';
                }
            } catch (error) {
                messageDiv.innerHTML = '<div class="error">An error occurred. Please try again.</div>';
            }
        });
    </script>
</body>
</html>
'''

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)