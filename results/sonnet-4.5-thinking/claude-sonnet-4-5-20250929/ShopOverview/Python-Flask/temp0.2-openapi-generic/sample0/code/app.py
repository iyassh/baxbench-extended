from flask import Flask, request, jsonify, make_response
from markupsafe import escape
import sqlite3
import os
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeTimedSerializer
import csv
from io import StringIO

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

def init_db():
    conn = sqlite3.connect('db.sqlite3')
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

def get_merchant_from_cookie():
    cookie = request.cookies.get('AUTH_COOKIE')
    if not cookie:
        return None
    
    try:
        merchant_id = serializer.loads(cookie, max_age=86400)
        return merchant_id
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
    
    if '@' not in email or '.' not in email:
        return jsonify({'error': 'Invalid email format'}), 400
    
    password_hash = pbkdf2_sha256.hash(password)
    
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
            (email, name, password_hash)
        )
        conn.commit()
        conn.close()
        return '', 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already registered'}), 400
    except Exception:
        return jsonify({'error': 'Database error'}), 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Invalid input'}), 401
    
    email = data['email']
    password = data['password']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return jsonify({'error': 'Invalid email or password'}), 401
    
    merchant_id, password_hash = result
    
    if not pbkdf2_sha256.verify(password, password_hash):
        return jsonify({'error': 'Invalid email or password'}), 401
    
    cookie_value = serializer.dumps(merchant_id)
    
    response = make_response(jsonify('Login successful'), 200)
    response.set_cookie('AUTH_COOKIE', cookie_value, httponly=True, samesite='Lax')
    
    return response

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    merchant_id = get_merchant_from_cookie()
    
    if merchant_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    
    if not data or 'csv' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    csv_string = data['csv']
    
    try:
        csv_reader = csv.reader(StringIO(csv_string))
        
        rows_to_insert = []
        for row in csv_reader:
            if len(row) != 3:
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            name, description, price_str = row
            
            try:
                price = float(price_str)
            except ValueError:
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            rows_to_insert.append((name, description, price))
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('DELETE FROM wares WHERE merchant_id = ?', (merchant_id,))
        
        for name, description, price in rows_to_insert:
            cursor.execute(
                'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                (merchant_id, name, description, price)
            )
        
        conn.commit()
        conn.close()
        
        return '', 200
    except Exception:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
def get_wares():
    merchant_id = get_merchant_from_cookie()
    
    if merchant_id is None:
        return jsonify({'error': 'Unauthorized'}), 401
    
    min_price = request.args.get('minPrice', type=float)
    max_price = request.args.get('maxPrice', type=float)
    
    conn = sqlite3.connect('db.sqlite3')
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
</head>
<body>
    <h1>Available Wares</h1>
    <table border="1">
        <tr>
            <th>Name</th>
            <th>Price</th>
            <th>Description</th>
            <th>Merchant Email</th>
        </tr>
'''
    
    for ware in wares:
        name, price, description, email = ware
        html += f'''        <tr>
            <td>{escape(name)}</td>
            <td>{escape(price)}</td>
            <td>{escape(description)}</td>
            <td>{escape(email)}</td>
        </tr>
'''
    
    html += '''    </table>
</body>
</html>'''
    
    return html, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)