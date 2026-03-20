import os
import sqlite3
import csv
import io
from functools import wraps
from datetime import datetime, timedelta

from flask import Flask, request, jsonify, render_template_string, session
from werkzeug.security import generate_password_hash, check_password_hash
import jwt

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS merchants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        )
    ''')
    
    db.commit()
    db.close()

def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.cookies.get('AUTH_COOKIE')
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            payload = jwt.decode(token, app.secret_key, algorithms=['HS256'])
            request.merchant_id = payload['merchant_id']
            request.merchant_email = payload['email']
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Unauthorized'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

@app.route('/merchants/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not all(k in data for k in ['email', 'name', 'password']):
        return jsonify({'error': 'Invalid input'}), 400
    
    email = data.get('email', '').strip()
    name = data.get('name', '').strip()
    password = data.get('password', '').strip()
    
    if not email or not name or not password:
        return jsonify({'error': 'Invalid input'}), 400
    
    if '@' not in email:
        return jsonify({'error': 'Invalid input'}), 400
    
    db = get_db()
    cursor = db.cursor()
    
    try:
        hashed_password = generate_password_hash(password)
        cursor.execute(
            'INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)',
            (email, name, hashed_password)
        )
        db.commit()
        return jsonify({'message': 'Merchant registered successfully'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already registered'}), 400
    finally:
        db.close()

@app.route('/merchants/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Invalid email or password'}), 401
    
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()
    
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT id, email, password FROM merchants WHERE email = ?', (email,))
    merchant = cursor.fetchone()
    db.close()
    
    if not merchant or not check_password_hash(merchant['password'], password):
        return jsonify({'error': 'Invalid email or password'}), 401
    
    token = jwt.encode(
        {
            'merchant_id': merchant['id'],
            'email': merchant['email'],
            'exp': datetime.utcnow() + timedelta(days=7)
        },
        app.secret_key,
        algorithm='HS256'
    )
    
    response = jsonify({'message': 'Login successful'})
    response.set_cookie('AUTH_COOKIE', token, httponly=True, max_age=7*24*60*60)
    return response, 200

@app.route('/merchants/upload-wares', methods=['POST'])
@require_auth
def upload_wares():
    data = request.get_json()
    
    if not data or 'csv' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    csv_string = data.get('csv', '').strip()
    
    if not csv_string:
        return jsonify({'error': 'Invalid CSV format'}), 400
    
    try:
        csv_reader = csv.DictReader(io.StringIO(csv_string))
        
        if not csv_reader.fieldnames or set(csv_reader.fieldnames) != {'name', 'description', 'price'}:
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        db = get_db()
        cursor = db.cursor()
        
        rows_added = 0
        for row in csv_reader:
            try:
                name = row.get('name', '').strip()
                description = row.get('description', '').strip()
                price = float(row.get('price', 0))
                
                if not name or price < 0:
                    return jsonify({'error': 'Invalid CSV format'}), 400
                
                cursor.execute(
                    'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                    (request.merchant_id, name, description, price)
                )
                rows_added += 1
            except (ValueError, KeyError):
                db.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
        
        db.commit()
        db.close()
        
        return jsonify({'message': 'Wares uploaded successfully', 'rows': rows_added}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
@require_auth
def get_wares():
    min_price = request.args.get('minPrice', type=float, default=None)
    max_price = request.args.get('maxPrice', type=float, default=None)
    
    db = get_db()
    cursor = db.cursor()
    
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
    
    query += ' ORDER BY w.price ASC'
    
    cursor.execute(query, params)
    wares = cursor.fetchall()
    db.close()
    
    html_template = '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Warehouse - Available Wares</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 20px;
                background-color: #f5f5f5;
            }
            h1 {
                color: #333;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                background-color: white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            th {
                background-color: #4CAF50;
                color: white;
                padding: 12px;
                text-align: left;
                font-weight: bold;
            }
            td {
                padding: 12px;
                border-bottom: 1px solid #ddd;
            }
            tr:hover {
                background-color: #f9f9f9;
            }
            .price {
                font-weight: bold;
                color: #4CAF50;
            }
        </style>
    </head>
    <body>
        <h1>Available Wares</h1>
        {% if wares %}
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
                {% for ware in wares %}
                <tr>
                    <td>{{ ware[0] }}</td>
                    <td>{{ ware[1] }}</td>
                    <td class="price">${{ "%.2f"|format(ware[2]) }}</td>
                    <td>{{ ware[3] }}</td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% else %}
        <p>No wares found matching your criteria.</p>
        {% endif %}
    </body>
    </html>
    '''
    
    return render_template_string(html_template, wares=wares), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)