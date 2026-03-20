import sqlite3
import json
import os
from flask import Flask, request, jsonify, g

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                properties TEXT NOT NULL DEFAULT '{}'
            )
        ''')
        db.commit()


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


@app.route('/add', methods=['POST'])
def add_product():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid input'}), 400

        if 'name' not in data or not isinstance(data['name'], str) or not data['name'].strip():
            return jsonify({'error': 'Invalid input'}), 400

        name = data['name'].strip()

        # Validate all values are strings
        properties = {}
        for key, value in data.items():
            if key == 'name':
                continue
            if not isinstance(value, str):
                return jsonify({'error': 'Invalid input'}), 400
            properties[key] = value

        properties_json = json.dumps(properties)

        db = get_db()
        try:
            db.execute(
                'INSERT INTO products (name, properties) VALUES (?, ?)',
                (name, properties_json)
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Product already exists'}), 400

        return jsonify({'message': 'Product successfully added'}), 201

    except Exception:
        return jsonify({'error': 'An error occurred'}), 500


@app.route('/download', methods=['GET'])
def download_product():
    try:
        name = request.args.get('name')
        if not name or not isinstance(name, str):
            return jsonify({'error': 'Invalid input'}), 400

        db = get_db()
        row = db.execute(
            'SELECT name, properties FROM products WHERE name = ?',
            (name,)
        ).fetchone()

        if row is None:
            return jsonify({'error': 'Product not found'}), 404

        product_data = {'name': row['name']}
        props = json.loads(row['properties'])
        product_data.update(props)

        data_str = json.dumps(product_data)

        return jsonify({'data': data_str}), 200

    except Exception:
        return jsonify({'error': 'An error occurred'}), 500


@app.route('/upload', methods=['POST'])
def upload_product():
    try:
        body = request.get_json()
        if body is None:
            return jsonify({'error': 'Invalid upload query'}), 400

        name = body.get('name')
        data_str = body.get('data')

        if not name or not isinstance(name, str) or not name.strip():
            return jsonify({'error': 'Invalid upload query'}), 400

        if data_str is None or not isinstance(data_str, str):
            return jsonify({'error': 'Invalid upload query'}), 400

        name = name.strip()

        try:
            product_data = json.loads(data_str)
        except (json.JSONDecodeError, ValueError):
            return jsonify({'error': 'Invalid upload query'}), 400

        if not isinstance(product_data, dict):
            return jsonify({'error': 'Invalid upload query'}), 400

        # Validate all values are strings
        properties = {}
        for key, value in product_data.items():
            if key == 'name':
                continue
            if not isinstance(value, str):
                return jsonify({'error': 'Invalid upload query'}), 400
            properties[key] = value

        properties_json = json.dumps(properties)

        db = get_db()
        cursor = db.execute(
            'UPDATE products SET properties = ? WHERE name = ?',
            (properties_json, name)
        )
        if cursor.rowcount == 0:
            # Insert if not exists
            db.execute(
                'INSERT INTO products (name, properties) VALUES (?, ?)',
                (name, properties_json)
            )
        db.commit()

        return jsonify({'message': 'Product updated successfully'}), 200

    except Exception:
        return jsonify({'error': 'An error occurred'}), 500


@app.route('/search', methods=['GET'])
def search_products():
    try:
        query = request.args.get('query')
        if query is None or not isinstance(query, str):
            return jsonify({'error': 'Invalid search query'}), 400

        db = get_db()
        rows = db.execute(
            'SELECT name, properties FROM products'
        ).fetchall()

        results = []
        query_lower = query.lower()

        for row in rows:
            name = row['name']
            try:
                props = json.loads(row['properties'])
            except (json.JSONDecodeError, ValueError):
                props = {}

            matched = False

            if query_lower in name.lower():
                matched = True
            else:
                for value in props.values():
                    if isinstance(value, str) and query_lower in value.lower():
                        matched = True
                        break

            if matched:
                product = {'name': name}
                product.update(props)
                results.append(product)

        return jsonify({'results': results}), 200

    except Exception:
        return jsonify({'error': 'An error occurred'}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
else:
    init_db()