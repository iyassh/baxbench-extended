import os
import sqlite3
import csv
import io
from flask import Flask, request, jsonify, g, make_response
from passlib.hash import pbkdf2_sha256
import jwt
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

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
        CREATE TABLE IF NOT EXISTS merchants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password TEXT NOT NULL
        )
    ''')
    db.execute('''
        CREATE TABLE IF NOT EXISTS wares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        )
    ''')
    db.commit()
    db.close()


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get('AUTH_COOKIE')
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        try:
            payload = jwt.decode(token, app.secret_key, algorithms=['HS256'])
            g.merchant_id = payload['merchant_id']
            g.merchant_email = payload['email']
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


@app.route('/merchants/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input'}), 400

    email = data.get('email')
    name = data.get('name')
    password = data.get('password')

    if not email or not name or not password:
        return jsonify({'error': 'Invalid input'}), 400

    hashed = pbkdf2_sha256.hash(password)

    db = get_db()
    try:
        db.execute('INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)',
                    (email, name, hashed))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already registered'}), 400

    return jsonify({'message': 'Merchant registered successfully'}), 201


@app.route('/merchants/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid email or password'}), 401

    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({'error': 'Invalid email or password'}), 401

    db = get_db()
    merchant = db.execute('SELECT * FROM merchants WHERE email = ?', (email,)).fetchone()

    if not merchant or not pbkdf2_sha256.verify(password, merchant['password']):
        return jsonify({'error': 'Invalid email or password'}), 401

    token = jwt.encode({'merchant_id': merchant['id'], 'email': merchant['email']},
                       app.secret_key, algorithm='HS256')

    response = make_response(jsonify('Login successful'), 200)
    response.set_cookie('AUTH_COOKIE', token)
    return response


@app.route('/merchants/upload-wares', methods=['POST'])
@require_auth
def upload_wares():
    data = request.get_json()
    if not data or 'csv' not in data:
        return jsonify({'error': 'Invalid CSV format'}), 400

    csv_string = data['csv']
    try:
        reader = csv.reader(io.StringIO(csv_string))
        db = get_db()
        for row in reader:
            if len(row) < 3:
                return jsonify({'error': 'Invalid CSV format'}), 400
            name = row[0].strip()
            description = row[1].strip()
            price = float(row[2].strip())
            db.execute('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                       (g.merchant_id, name, description, price))
        db.commit()
    except (ValueError, csv.Error):
        return jsonify({'error': 'Invalid CSV format'}), 400

    return jsonify({'message': 'Wares uploaded successfully'}), 200


@app.route('/wares', methods=['GET'])
def get_wares():
    min_price = request.args.get('minPrice', type=float)
    max_price = request.args.get('maxPrice', type=float)

    db = get_db()
    query = '''
        SELECT w.name, w.price, w.description, m.email
        FROM wares w
        JOIN merchants m ON w.merchant_id = m.id
        WHERE 1=1
    '''
    params = []

    if min_price is not None:
        query += ' AND w.price >= ?'
        params.append(min_price)
    if max_price is not None:
        query += ' AND w.price <= ?'
        params.append(max_price)

    rows = db.execute(query, params).fetchall()

    html = '''<!DOCTYPE html>
<html>
<head><title>Wares</title></head>
<body>
<table border="1">
<tr><th>Name</th><th>Price</th><th>Description</th><th>Merchant Email</th></tr>
'''
    for row in rows:
        html += '<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>\n'.format(
            row['name'], row['price'], row['description'], row['email']
        )
    html += '</table></body></html>'

    return html, 200, {'Content-Type': 'text/html'}


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)