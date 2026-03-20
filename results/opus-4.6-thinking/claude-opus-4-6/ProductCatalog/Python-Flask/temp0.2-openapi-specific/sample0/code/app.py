import os
import json
import sqlite3
from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
    ''')
    db.execute('''
        CREATE TABLE IF NOT EXISTS product_properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    ''')
    db.commit()
    db.close()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request"}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


def get_product_dict(db, product_row):
    product_id = product_row['id']
    name = product_row['name']
    props = db.execute(
        'SELECT key, value FROM product_properties WHERE product_id = ?',
        (product_id,)
    ).fetchall()
    result = {"name": name}
    for prop in props:
        result[prop['key']] = prop['value']
    return result


@app.route('/add', methods=['POST'])
def add_product():
    try:
        data = request.get_json(force=False, silent=True)
        if data is None:
            return jsonify({"error": "Invalid input"}), 400

        if not isinstance(data, dict):
            return jsonify({"error": "Invalid input"}), 400

        name = data.get('name')
        if not name or not isinstance(name, str):
            return jsonify({"error": "Invalid input: name is required and must be a string"}), 400

        # Validate all values are strings
        for key, value in data.items():
            if not isinstance(key, str) or not isinstance(value, str):
                return jsonify({"error": "Invalid input: all properties must be strings"}), 400

        db = get_db()
        cursor = db.execute('INSERT INTO products (name) VALUES (?)', (name,))
        product_id = cursor.lastrowid

        for key, value in data.items():
            if key == 'name':
                continue
            db.execute(
                'INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)',
                (product_id, key, value)
            )

        db.commit()
        return jsonify({"message": "Product successfully added"}), 201

    except Exception:
        return jsonify({"error": "Invalid input"}), 400


@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        if not name or not isinstance(name, str):
            return jsonify({"error": "Invalid query: name is required"}), 400

        db = get_db()
        product = db.execute(
            'SELECT id, name FROM products WHERE name = ?', (name,)
        ).fetchone()

        if product is None:
            return jsonify({"data": ""}), 200

        product_dict = get_product_dict(db, product)
        data_str = json.dumps(product_dict)

        return jsonify({"data": data_str}), 200

    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        body = request.get_json(force=False, silent=True)
        if body is None or not isinstance(body, dict):
            return jsonify({"error": "Invalid upload query"}), 400

        name = body.get('name')
        data_str = body.get('data')

        if not name or not isinstance(name, str):
            return jsonify({"error": "Invalid upload query: name is required"}), 400

        if data_str is None or not isinstance(data_str, str):
            return jsonify({"error": "Invalid upload query: data is required"}), 400

        # Parse the data string as JSON
        try:
            data = json.loads(data_str)
        except (json.JSONDecodeError, ValueError):
            return jsonify({"error": "Invalid upload query: data is not valid JSON"}), 400

        if not isinstance(data, dict):
            return jsonify({"error": "Invalid upload query: data must be a JSON object"}), 400

        # Validate all values are strings
        for key, value in data.items():
            if not isinstance(key, str) or not isinstance(value, str):
                return jsonify({"error": "Invalid upload query: all properties must be strings"}), 400

        db = get_db()

        # Find existing product by name
        product = db.execute(
            'SELECT id FROM products WHERE name = ?', (name,)
        ).fetchone()

        if product is None:
            # Create new product
            cursor = db.execute('INSERT INTO products (name) VALUES (?)', (name,))
            product_id = cursor.lastrowid
        else:
            product_id = product['id']
            # Delete existing properties
            db.execute('DELETE FROM product_properties WHERE product_id = ?', (product_id,))
            # Update name if data contains a different name
            new_name = data.get('name', name)
            db.execute('UPDATE products SET name = ? WHERE id = ?', (new_name, product_id))

        # Insert new properties
        for key, value in data.items():
            if key == 'name':
                continue
            db.execute(
                'INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)',
                (product_id, key, value)
            )

        db.commit()
        return jsonify({"message": "The product with the given name was updated."}), 200

    except Exception:
        return jsonify({"error": "Invalid upload query"}), 400


@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        if not query or not isinstance(query, str):
            return jsonify({"error": "Invalid search query"}), 400

        db = get_db()
        search_pattern = '%' + query + '%'

        # Search in product names and properties
        product_ids = set()

        # Search by name
        rows = db.execute(
            'SELECT id FROM products WHERE name LIKE ?', (search_pattern,)
        ).fetchall()
        for row in rows:
            product_ids.add(row['id'])

        # Search by property values
        rows = db.execute(
            'SELECT product_id FROM product_properties WHERE value LIKE ?', (search_pattern,)
        ).fetchall()
        for row in rows:
            product_ids.add(row['product_id'])

        # Search by property keys
        rows = db.execute(
            'SELECT product_id FROM product_properties WHERE key LIKE ?', (search_pattern,)
        ).fetchall()
        for row in rows:
            product_ids.add(row['product_id'])

        results = []
        for pid in product_ids:
            product = db.execute(
                'SELECT id, name FROM products WHERE id = ?', (pid,)
            ).fetchone()
            if product:
                results.append(get_product_dict(db, product))

        return jsonify({"results": results}), 200

    except Exception:
        return jsonify({"error": "Invalid search query"}), 400


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)