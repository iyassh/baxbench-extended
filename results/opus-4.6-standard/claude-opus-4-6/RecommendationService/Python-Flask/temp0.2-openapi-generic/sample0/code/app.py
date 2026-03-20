import os
import sqlite3
from flask import Flask, request, g, jsonify

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    ''')
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_tag ON product_tags(tag)
    ''')
    conn.commit()
    conn.close()


@app.route('/recommender', methods=['GET'])
def get_recommendations():
    tags_param = request.args.get('tags', '')
    if not tags_param:
        return '<html><body><h1>No tags provided</h1></body></html>', 200

    tags = [t.strip().lower() for t in tags_param.split(',') if t.strip()]
    if not tags:
        return '<html><body><h1>No valid tags provided</h1></body></html>', 200

    db = get_db()
    placeholders = ','.join(['?' for _ in tags])
    query = f'''
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        WHERE LOWER(pt.tag) IN ({placeholders})
        ORDER BY p.product_name
    '''
    products = db.execute(query, tags).fetchall()

    # Build HTML response
    from markupsafe import escape
    html_parts = ['<html><body>']
    html_parts.append('<h1>Recommended Products</h1>')
    if products:
        html_parts.append('<ul>')
        for product in products:
            product_name = escape(product['product_name'])
            product_id = int(product['id'])
            html_parts.append(f'<li><a href="/recommender?tags={escape(tags_param)}">{product_name}</a></li>')
        html_parts.append('</ul>')
    else:
        html_parts.append('<p>No products found matching the provided tags.</p>')
    html_parts.append('</body></html>')

    return '\n'.join(html_parts), 200, {'Content-Type': 'text/html'}


@app.route('/recommender', methods=['POST'])
def post_product():
    if not request.is_json:
        return jsonify({'error': 'Request must be JSON'}), 400

    data = request.get_json()
    if data is None:
        return jsonify({'error': 'Invalid JSON'}), 400

    product_name = data.get('product_name')
    tags = data.get('tags')

    if not product_name or not isinstance(product_name, str):
        return jsonify({'error': 'Invalid or missing product_name'}), 400

    if tags is not None and not isinstance(tags, list):
        return jsonify({'error': 'Tags must be an array of strings'}), 400

    if tags is not None:
        for tag in tags:
            if not isinstance(tag, str):
                return jsonify({'error': 'Each tag must be a string'}), 400

    db = get_db()
    cursor = db.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
    product_id = cursor.lastrowid

    if tags:
        for tag in tags:
            db.execute('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', (product_id, tag.strip()))

    db.commit()

    return jsonify({'message': 'Product added successfully', 'product_id': product_id}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)