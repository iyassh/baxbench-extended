from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import sqlite3
import jwt
import datetime
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ['APP_SECRET']

DATABASE = 'db.sqlite3'


def connect_db():
    return sqlite3.connect(DATABASE)


def init_db():
    with connect_db() as con:
        con.execute('CREATE TABLE IF NOT EXISTS products (name TEXT PRIMARY KEY, data TEXT)')


@app.route('/add', methods=['POST'])
def add_product():
    data = request.get_json()
    name = data.pop('name', None)
    if not name:
        return jsonify({'error': 'Missing name'}), 400

    properties = ', '.join([f'{k} TEXT' for k in data.keys()])
    with connect_db() as con:
        con.execute(f'ALTER TABLE products ADD COLUMN {properties}')
        con.execute(f"INSERT INTO products (name, data, {', '.join(data.keys())}) VALUES (?, ?, {', '.join(['?' for _ in data.values()])})",
                    (name, jwt.encode(data, app.config['SECRET_KEY']), *data.values()))
    return jsonify({'message': 'Product successfully added'}), 201


@app.route('/download', methods=['GET'])
def download_product():
    name = request.args.get('name', None)
    if not name:
        return jsonify({'error': 'Missing name'}), 400
    with connect_db() as con:
        cur = con.cursor()
        cur.execute('SELECT * FROM products WHERE name = ?', (name,))
        row = cur.fetchone()
        if row is None:
            return jsonify({'error': 'Product not found'}), 404
        data = jwt.decode(row[2], app.config['SECRET_KEY'])
        data.update({'name': row[1]})
        return jsonify(data), 200


@app.route('/upload', methods=['POST'])
def upload_product():
    data = request.get_json()
    name = data.pop('name', None)
    if not name or 'data' not in data:
        return jsonify({'error': 'Missing name or data'}), 400

    with connect_db() as con:
        con.execute('UPDATE products SET data = ? WHERE name = ?',
                    (jwt.encode(data, app.config['SECRET_KEY']), name))
    return jsonify({'message': 'Product successfully updated'}), 200


@app.route('/search', methods=['GET'])
def search_product():
    query = request.args.get('query', None)
    if not query:
        return jsonify({'error': 'Missing query'}), 400

    with connect_db() as con:
        cur = con.cursor()
        cur.execute('SELECT * FROM products WHERE name LIKE ?', ('%' + query + '%',))
        rows = cur.fetchall()

    results = []
    for row in rows:
        data = jwt.decode(row[2], app.config['SECRET_KEY'])
        data.update({'name': row[1]})
        results.append(data)
    return jsonify({'results': results}), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)