<CODE>
import os
import sqlite3
from flask import Flask, request, jsonify, make_response, render_template_string
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import secrets
import csv
from io import StringIO

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
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
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            merchant_id INTEGER NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.cookies.get('AUTH_COOKIE')
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT merchant_id FROM sessions WHERE token = ?', (token,))
        session = cursor.fetchone()
        conn.close()
        
        if not session:
            return jsonify({'error': 'Unauthorized'}), 401
        
        request.merchant_id = session['merchant_id']
        return f(*args, **kwargs)
    
    return decorated_function

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    data = request.get_json()
    
    if not data or 'email' not in data or 'name' not in data or 'password' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    email = data['email']
    name = data['name']
    password = data['password']
    
    if not email or not name or not password:
        return jsonify({'error': 'Invalid input'}), 400
    
    password_hash = generate_password_hash(password)
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
            (email, name, password_hash)
        )
        conn.commit()
        conn.close()
        return jsonify({'message': 'Merchant registered successfully'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already exists'}), 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Invalid input'}), 401
    
    email = data['email']
    password = data['password']
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
    merchant = cursor.fetchone()
    
    if not merchant or not check_password_hash(merchant['password_hash'], password):
        conn.close()
        return jsonify({'error': 'Invalid email or password'}), 401
    
    token = secrets.token_hex(32)
    cursor.execute('INSERT INTO sessions (token, merchant_id) VALUES (?, ?)', (token, merchant['id']))
    conn.commit()
    conn.close()
    
    response = make_response(jsonify('Login successful'), 200)
    response.set_cookie('AUTH_COOKIE', token, httponly=True, samesite='Strict')
    return response

@app.route('/merchants/upload-wares', methods=['POST'])
@require_auth
def upload_wares():
    data = request.get_json()
    
    if not data or 'csv' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    csv_data = data['csv']
    
    try:
        csv_file = StringIO(csv_data)
        csv_reader = csv.DictReader(csv_file)
        
        required_fields = {'name', 'description', 'price'}
        if not required_fields.issubset(set(csv_reader.fieldnames or [])):
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        for row in csv_reader:
            name = row.get('name', '').strip()
            description = row.get('description', '').strip()
            price_str = row.get('price', '').strip()
            
            if not name or not price_str:
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            try:
                price = float(price_str)
            except ValueError:
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            cursor.execute(
                'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                (request.merchant_id, name, description, price)
            )
        
        conn.commit()
        conn.close()
        return jsonify({'message': 'Wares uploaded successfully'}), 200
    except Exception as e:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
@require_auth
def get_wares():
    min_price = request.args.get('minPrice', type=float)
    max_price = request.args.get('maxPrice', type=float)
    
    conn = get_db()
    cursor = conn.cursor()
    
    query = '''
        SELECT w.name, w.description, w.price, m.email
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
    
    query += ' ORDER BY w.name'
    
    cursor.execute(query, params)
    wares = cursor.fetchall()
    conn.close()
    
    html_template = '''
    <!DOCTYPE html>
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
        <h1>Wares</h1>
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Price</th>
                    <th>Description</th>
                    <th>Merchant Email</th>
                </tr>
            </thead>
            <tbody>
                {% for ware in wares %}
                <tr>
                    <td>{{ ware.name }}</td>
                    <td>{{ ware.price }}</td>
                    <td>{{ ware.description }}</td>
                    <td>{{ ware.email }}</td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
    </body>
    </html>
    '''
    
    return render_template_string(html_template, wares=wares)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)
</CODE>