from flask import Flask, request, jsonify, render_template_string
import sqlite3
import os

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
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
            tag_name TEXT NOT NULL UNIQUE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_tags (
            product_id INTEGER,
            tag_id INTEGER,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (tag_id) REFERENCES tags(id),
            PRIMARY KEY (product_id, tag_id)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags', '')
    
    if not tags_param:
        template = '<html><body><h1>Products</h1><p>No tags provided</p></body></html>'
        return render_template_string(template), 200
    
    tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
    
    if not tags:
        template = '<html><body><h1>Products</h1><p>No valid tags provided</p></body></html>'
        return render_template_string(template), 200
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
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
    conn.close()
    
    template = '''
    <html>
    <body>
        <h1>Recommended Products</h1>
        {% if products %}
        <ul>
            {% for product in products %}
            <li><a href="#product-{{ product.id }}">{{ product.product_name }}</a></li>
            {% endfor %}
        </ul>
        {% else %}
        <p>No products found</p>
        {% endif %}
    </body>
    </html>
    '''
    
    return render_template_string(template, products=products), 200

@app.route('/recommender', methods=['POST'])
def post_product():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        product_name = data.get('product_name')
        tags = data.get('tags')
        
        if not product_name:
            return jsonify({'error': 'product_name is required'}), 400
        
        if not tags or not isinstance(tags, list):
            return jsonify({'error': 'tags must be a non-empty array'}), 400
        
        valid_tags = []
        for tag in tags:
            if isinstance(tag, str) and tag.strip():
                valid_tags.append(tag.strip())
        
        if not valid_tags:
            return jsonify({'error': 'tags must contain at least one valid tag'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
        product_id = cursor.lastrowid
        
        for tag in valid_tags:
            cursor.execute('INSERT OR IGNORE INTO tags (tag_name) VALUES (?)', (tag,))
            cursor.execute('SELECT id FROM tags WHERE tag_name = ?', (tag,))
            tag_row = cursor.fetchone()
            tag_id = tag_row['id']
            cursor.execute('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', (product_id, tag_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Product added successfully'}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)