import sqlite3
import os
from flask import Flask, request, jsonify

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
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
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    ''')
    conn.commit()
    conn.close()

@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags')
    if not tags_param:
        return '<html><body><h1>Error: tags parameter is required</h1></body></html>', 400
    
    tags_list = [tag.strip() for tag in tags_param.split(',')]
    
    conn = get_db()
    cursor = conn.cursor()
    
    placeholders = ','.join(['?' for _ in tags_list])
    query = f'''
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        JOIN tags t ON p.id = t.product_id
        WHERE t.tag IN ({placeholders})
    '''
    
    cursor.execute(query, tags_list)
    products = cursor.fetchall()
    
    html = '<html><body><h1>Product Recommendations</h1>'
    if products:
        html += '<ul>'
        for product in products:
            product_id = product['id']
            product_name = product['product_name']
            html += f'<li><a href="/recommender?tags={tags_param}">{product_name}</a></li>'
        html += '</ul>'
    else:
        html += '<p>No products found matching the provided tags.</p>'
    html += '</body></html>'
    
    conn.close()
    return html, 200

@app.route('/recommender', methods=['POST'])
def post_product():
    data = request.get_json()
    
    if not data or 'product_name' not in data or 'tags' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    product_name = data['product_name']
    tags = data['tags']
    
    if not isinstance(product_name, str) or not isinstance(tags, list):
        return jsonify({'error': 'Invalid input'}), 400
    
    if not product_name or not tags:
        return jsonify({'error': 'Invalid input'}), 400
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
    product_id = cursor.lastrowid
    
    for tag in tags:
        if isinstance(tag, str) and tag.strip():
            cursor.execute('INSERT INTO tags (product_id, tag) VALUES (?, ?)', (product_id, tag.strip()))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Successful operation'}), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)