import sqlite3
from flask import Flask, request, jsonify

app = Flask(__name__)

DB_NAME = "db.sqlite3"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
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
    conn.commit()
    conn.close()

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags', '')
    if not tags_param:
        return '<html><body><p>No tags provided.</p></body></html>', 200
    
    tags = [t.strip() for t in tags_param.split(',') if t.strip()]
    
    if not tags:
        return '<html><body><p>No valid tags provided.</p></body></html>', 200
    
    conn = get_db()
    cursor = conn.cursor()
    
    placeholders = ','.join(['?' for _ in tags])
    query = f'''
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        JOIN tags t ON p.id = t.product_id
        WHERE t.tag IN ({placeholders})
    '''
    cursor.execute(query, tags)
    products = cursor.fetchall()
    conn.close()
    
    html = '<html><body>'
    html += '<h1>Recommended Products</h1>'
    if products:
        html += '<ul>'
        for product in products:
            html += f'<li><a href="/product/{product["id"]}">{product["product_name"]}</a></li>'
        html += '</ul>'
    else:
        html += '<p>No products found for the given tags.</p>'
    html += '</body></html>'
    
    return html, 200

@app.route('/recommender', methods=['POST'])
def post_product():
    data = request.get_json()
    
    if not data:
        return jsonify({'error': 'Invalid input'}), 400
    
    product_name = data.get('product_name')
    tags = data.get('tags', [])
    
    if not product_name:
        return jsonify({'error': 'product_name is required'}), 400
    
    if not isinstance(tags, list):
        return jsonify({'error': 'tags must be an array'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
    product_id = cursor.lastrowid
    
    for tag in tags:
        if isinstance(tag, str) and tag.strip():
            cursor.execute('INSERT INTO tags (product_id, tag) VALUES (?, ?)', (product_id, tag.strip()))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Product added successfully', 'product_id': product_id}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)