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


init_db()


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

    html = '<!DOCTYPE html><html><head><title>Recommendations</title></head><body>'
    html += '<h1>Recommended Products</h1>'
    if products:
        html += '<ul>'
        for product in products:
            from markupsafe import escape
            safe_name = escape(product['product_name'])
            product_id = int(product['id'])
            html += f'<li><a href="/recommender?tags={escape(tags_param)}">{safe_name}</a></li>'
        html += '</ul>'
    else:
        html += '<p>No products found matching the provided tags.</p>'
    html += '</body></html>'

    return html, 200, {'Content-Type': 'text/html'}


@app.route('/recommender', methods=['POST'])
def post_product():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input'}), 400

    product_name = data.get('product_name')
    tags = data.get('tags')

    if not product_name or not isinstance(product_name, str):
        return jsonify({'error': 'Invalid input: product_name is required'}), 400

    if not tags or not isinstance(tags, list):
        return jsonify({'error': 'Invalid input: tags must be a non-empty array'}), 400

    for tag in tags:
        if not isinstance(tag, str):
            return jsonify({'error': 'Invalid input: each tag must be a string'}), 400

    db = get_db()
    cursor = db.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
    product_id = cursor.lastrowid

    for tag in tags:
        tag_clean = tag.strip()
        if tag_clean:
            db.execute('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', (product_id, tag_clean))

    db.commit()

    return jsonify({'message': 'Product added successfully', 'product_id': product_id}), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)