from flask import Flask, request, jsonify, make_response
from markupsafe import escape
import sqlite3
import os
from passlib.hash import bcrypt
from itsdangerous import URLSafeTimedSerializer
import csv
from io import StringIO

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'dev-secret-key')

DB_NAME = 'db.sqlite3'

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

init_db()

serializer = URLSafeTimedSerializer(app.secret_key)

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def get_current_merchant():
    cookie = request.cookies.get('AUTH_COOKIE')
    if not cookie:
        return None
    
    try:
        merchant_id = serializer.loads(cookie, max_age=86400)
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM merchants WHERE id = ?', (merchant_id,))
        merchant = cursor.fetchone()
        conn.close()
        return merchant
    except:
        return None

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    data = request.get_json()
    
    if not data or 'email' not in data or 'name' not in data or 'password' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    email = data['email']
    name = data['name']
    password = data['password']
    
    password_hash = bcrypt.hash(password)
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                      (email, name, password_hash))
        conn.commit()
        return jsonify({'message': 'Merchant registered successfully'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already registered'}), 400
    finally:
        conn.close()

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Invalid input'}), 401
    
    email = data['email']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM merchants WHERE email = ?', (email,))
    merchant = cursor.fetchone()
    conn.close()
    
    if not merchant or not bcrypt.verify(password, merchant['password_hash']):
        return jsonify({'error': 'Invalid email or password'}), 401
    
    token = serializer.dumps(merchant['id'])
    response = make_response(jsonify('Login successful'), 200)
    response.set_cookie('AUTH_COOKIE', token, httponly=True, samesite='Lax')
    
    return response

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    merchant = get_current_merchant()
    if not merchant:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    if not data or 'csv' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    csv_data = data['csv']
    
    conn = get_db()
    try:
        csv_file = StringIO(csv_data)
        reader = csv.DictReader(csv_file)
        
        cursor = conn.cursor()
        
        for row in reader:
            if 'name' not in row or 'description' not in row or 'price' not in row:
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            name = row['name']
            description = row['description']
            try:
                price = float(row['price'])
            except ValueError:
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            cursor.execute('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                          (merchant['id'], name, description, price))
        
        conn.commit()
        return jsonify({'message': 'Wares uploaded successfully'}), 200
    except Exception as e:
        return jsonify({'error': 'Invalid CSV format'}), 400
    finally:
        conn.close()

@app.route('/wares', methods=['GET'])
def get_wares():
    merchant = get_current_merchant()
    if not merchant:
        return jsonify({'error': 'Unauthorized'}), 401
    
    min_price = request.args.get('minPrice', type=float)
    max_price = request.args.get('maxPrice', type=float)
    
    conn = get_db()
    cursor = conn.cursor()
    
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
    
    cursor.execute(query, params)
    wares = cursor.fetchall()
    conn.close()
    
    html = '''<!DOCTYPE html>
<html>
<head>
    <title>Wares</title>
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
        }
        th, td {
            border: 1px solid black;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #f2f2f2;
        }
    </style>
</head>
<body>
    <h1>Available Wares</h1>
    <table>
        <tr>
            <th>Name</th>
            <th>Price</th>
            <th>Description</th>
            <th>Merchant Email</th>
        </tr>
'''
    
    for ware in wares:
        html += f'''        <tr>
            <td>{escape(ware['name'])}</td>
            <td>{escape(str(ware['price']))}</td>
            <td>{escape(ware['description'])}</td>
            <td>{escape(ware['email'])}</td>
        </tr>
'''
    
    html += '''    </table>
</body>
</html>
'''
    
    return html, 200, {'Content-Type': 'text/html'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)