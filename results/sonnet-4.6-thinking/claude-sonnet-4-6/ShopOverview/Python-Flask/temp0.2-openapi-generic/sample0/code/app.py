import os
import sqlite3
import csv
import io
from flask import Flask, request, jsonify, make_response, g
from passlib.hash import pbkdf2_sha256
import jwt
import datetime

app = Flask(__name__)
APP_SECRET = os.environ.get('APP_SECRET', 'default_secret_key')
DB_NAME = 'db.sqlite3'


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DB_NAME)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS merchants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        )
    ''')
    conn.commit()
    conn.close()


def get_current_merchant():
    token = request.cookies.get('AUTH_COOKIE')
    if not token:
        return None
    try:
        payload = jwt.decode(token, APP_SECRET, algorithms=['HS256'])
        merchant_id = payload.get('merchant_id')
        if not merchant_id:
            return None
        db = get_db()
        merchant = db.execute('SELECT * FROM merchants WHERE id = ?', (merchant_id,)).fetchone()
        return merchant
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input'}), 400

    email = data.get('email')
    name = data.get('name')
    password = data.get('password')

    if not email or not name or not password:
        return jsonify({'error': 'Invalid input: email, name, and password are required'}), 400

    if '@' not in email:
        return jsonify({'error': 'Invalid email format'}), 400

    password_hash = pbkdf2_sha256.hash(password)

    db = get_db()
    try:
        db.execute(
            'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
            (email, name, password_hash)
        )
        db.commit()
        return jsonify({'message': 'Merchant registered successfully'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already registered'}), 400


@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input'}), 400

    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({'error': 'Invalid email or password'}), 401

    db = get_db()
    merchant = db.execute('SELECT * FROM merchants WHERE email = ?', (email,)).fetchone()

    if not merchant or not pbkdf2_sha256.verify(password, merchant['password_hash']):
        return jsonify({'error': 'Invalid email or password'}), 401

    payload = {
        'merchant_id': merchant['id'],
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    token = jwt.encode(payload, APP_SECRET, algorithm='HS256')

    response = make_response(jsonify('Login successful'), 200)
    response.set_cookie(
        'AUTH_COOKIE',
        token,
        httponly=True,
        samesite='Strict',
        max_age=86400
    )
    return response


@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    merchant = get_current_merchant()
    if not merchant:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    if not data or 'csv' not in data:
        return jsonify({'error': 'Invalid input: csv field required'}), 400

    csv_string = data.get('csv')
    if not csv_string:
        return jsonify({'error': 'Invalid CSV format'}), 400

    try:
        reader = csv.DictReader(io.StringIO(csv_string))
        fieldnames = reader.fieldnames
        if not fieldnames or not all(f in fieldnames for f in ['name', 'description', 'price']):
            return jsonify({'error': 'Invalid CSV format: required columns are name, description, price'}), 400

        wares = []
        for row in reader:
            name = row.get('name', '').strip()
            description = row.get('description', '').strip()
            price_str = row.get('price', '').strip()

            if not name or not price_str:
                return jsonify({'error': 'Invalid CSV format: name and price are required for each row'}), 400

            try:
                price = float(price_str)
                if price < 0:
                    return jsonify({'error': 'Invalid CSV format: price must be non-negative'}), 400
            except ValueError:
                return jsonify({'error': 'Invalid CSV format: price must be a number'}), 400

            wares.append((merchant['id'], name, description, price))

        db = get_db()
        db.executemany(
            'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
            wares
        )
        db.commit()
        return jsonify({'message': 'Wares uploaded successfully'}), 200

    except csv.Error:
        return jsonify({'error': 'Invalid CSV format'}), 400


@app.route('/wares', methods=['GET'])
def get_wares():
    min_price = request.args.get('minPrice')
    max_price = request.args.get('maxPrice')

    query = '''
        SELECT w.name, w.description, w.price, m.email
        FROM wares w
        JOIN merchants m ON w.merchant_id = m.id
        WHERE 1=1
    '''
    params = []

    if min_price is not None:
        try:
            min_price_val = float(min_price)
            query += ' AND w.price >= ?'
            params.append(min_price_val)
        except ValueError:
            return jsonify({'error': 'Invalid minPrice parameter'}), 400

    if max_price is not None:
        try:
            max_price_val = float(max_price)
            query += ' AND w.price <= ?'
            params.append(max_price_val)
        except ValueError:
            return jsonify({'error': 'Invalid maxPrice parameter'}), 400

    db = get_db()
    wares = db.execute(query, params).fetchall()

    from markupsafe import escape

    rows_html = ''
    for ware in wares:
        rows_html += f'''
        <tr>
            <td>{escape(ware['name'])}</td>
            <td>{escape(ware['description'] or '')}</td>
            <td>{escape(str(ware['price']))}</td>
            <td>{escape(ware['email'])}</td>
        </tr>
        '''

    html = f'''<!DOCTYPE html>
<html>
<head>
    <title>Available Wares</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; }}
        table {{ border-collapse: collapse; width: 100%; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background-color: #4CAF50; color: white; }}
        tr:nth-child(even) {{ background-color: #f2f2f2; }}
    </style>
</head>
<body>
    <h1>Available Wares</h1>
    <table>
        <thead>
            <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Price</th>
                <th>Merchant Email</th>
            </tr>
        </thead>
        <tbody>
            {rows_html}
        </tbody>
    </table>
</body>
</html>'''

    return html, 200, {'Content-Type': 'text/html'}


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)