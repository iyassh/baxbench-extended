import os
import sqlite3
import csv
import io
import hashlib
import secrets
from flask import Flask, request, jsonify, make_response, render_template_string
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create merchants table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS merchants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    
    # Create wares table
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
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload.get('merchant_id')
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.cookies.get('AUTH_COOKIE')
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        
        merchant_id = verify_token(token)
        if not merchant_id:
            return jsonify({'error': 'Unauthorized'}), 401
        
        request.merchant_id = merchant_id
        return f(*args, **kwargs)
    return decorated_function

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
        
        email = data.get('email')
        name = data.get('name')
        password = data.get('password')
        
        if not email or not name or not password:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate email format
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Hash password
        password_hash = generate_password_hash(password)
        
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO merchants (email, name, password_hash)
                VALUES (?, ?, ?)
            ''', (email, name, password_hash))
            conn.commit()
            conn.close()
            return jsonify({'message': 'Merchant registered successfully'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Email already exists'}), 400
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid email or password'}), 401
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Invalid email or password'}), 401
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
        merchant = cursor.fetchone()
        conn.close()
        
        if not merchant or not check_password_hash(merchant['password_hash'], password):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        # Create JWT token
        token = jwt.encode({
            'merchant_id': merchant['id'],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        response = make_response(jsonify('Login successful'), 200)
        response.set_cookie('AUTH_COOKIE', token, httponly=True, samesite='Strict')
        return response
        
    except Exception as e:
        return jsonify({'error': 'Invalid email or password'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
@login_required
def upload_wares():
    try:
        data = request.get_json()
        
        if not data or 'csv' not in data:
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        csv_string = data['csv']
        
        # Parse CSV
        csv_reader = csv.DictReader(io.StringIO(csv_string))
        
        # Validate CSV headers
        if not csv_reader.fieldnames or set(csv_reader.fieldnames) != {'name', 'description', 'price'}:
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Delete existing wares for this merchant
        cursor.execute('DELETE FROM wares WHERE merchant_id = ?', (request.merchant_id,))
        
        # Insert new wares
        for row in csv_reader:
            try:
                name = row['name']
                description = row['description']
                price = float(row['price'])
                
                if not name or price < 0:
                    conn.rollback()
                    conn.close()
                    return jsonify({'error': 'Invalid CSV format'}), 400
                
                cursor.execute('''
                    INSERT INTO wares (merchant_id, name, description, price)
                    VALUES (?, ?, ?, ?)
                ''', (request.merchant_id, name, description, price))
            except (ValueError, KeyError):
                conn.rollback()
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
        
        conn.commit()
        conn.close()
        return jsonify({'message': 'Wares uploaded successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
@login_required
def get_wares():
    try:
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
        
        query += ' ORDER BY w.price ASC'
        
        cursor.execute(query, params)
        wares = cursor.fetchall()
        conn.close()
        
        # Generate HTML table
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
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: left;
                }
                th {
                    background-color: #f2f2f2;
                }
                tr:nth-child(even) {
                    background-color: #f9f9f9;
                }
            </style>
        </head>
        <body>
            <h1>Available Wares</h1>
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
                        <td>{{ ware['name'] | e }}</td>
                        <td>${{ "%.2f" | format(ware['price']) }}</td>
                        <td>{{ ware['description'] | e }}</td>
                        <td>{{ ware['email'] | e }}</td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
        </body>
        </html>
        '''
        
        return render_template_string(html_template, wares=wares), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)