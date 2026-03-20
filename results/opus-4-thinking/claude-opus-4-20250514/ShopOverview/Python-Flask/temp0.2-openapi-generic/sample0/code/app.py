from flask import Flask, request, jsonify, make_response, render_template_string
import sqlite3
import os
import csv
import io
from passlib.hash import pbkdf2_sha256
from functools import wraps
import json

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

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

# Authentication decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_cookie = request.cookies.get('AUTH_COOKIE')
        if not auth_cookie:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            # Decode the auth cookie (simple implementation using merchant_id)
            merchant_id = int(auth_cookie)
            
            # Verify merchant exists
            conn = sqlite3.connect('db.sqlite3')
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM merchants WHERE id = ?', (merchant_id,))
            merchant = cursor.fetchone()
            conn.close()
            
            if not merchant:
                return jsonify({'error': 'Unauthorized'}), 401
                
            request.merchant_id = merchant_id
            return f(*args, **kwargs)
        except:
            return jsonify({'error': 'Unauthorized'}), 401
            
    return decorated_function

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'email' not in data or 'name' not in data or 'password' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        email = data['email']
        name = data['name']
        password = data['password']
        
        # Validate email format
        if '@' not in email or '.' not in email:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        # Insert into database
        conn = sqlite3.connect('db.sqlite3')
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
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Invalid email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        # Query merchant from database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
        merchant = cursor.fetchone()
        conn.close()
        
        if not merchant:
            return jsonify({'error': 'Invalid email or password'}), 401
        
        merchant_id, password_hash = merchant
        
        # Verify password
        if not pbkdf2_sha256.verify(password, password_hash):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        # Create response with cookie
        response = make_response(jsonify('Login successful'), 200)
        response.set_cookie('AUTH_COOKIE', str(merchant_id), httponly=True, secure=True, samesite='Strict')
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
        merchant_id = request.merchant_id
        
        # Parse CSV
        csv_file = io.StringIO(csv_string)
        csv_reader = csv.DictReader(csv_file)
        
        # Validate CSV columns
        if csv_reader.fieldnames is None or set(csv_reader.fieldnames) != {'name', 'description', 'price'}:
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Insert wares
        for row in csv_reader:
            try:
                name = row['name']
                description = row['description']
                price = float(row['price'])
                
                cursor.execute('''
                    INSERT INTO wares (merchant_id, name, description, price)
                    VALUES (?, ?, ?, ?)
                ''', (merchant_id, name, description, price))
            except:
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
        # Get query parameters
        min_price = request.args.get('minPrice', type=float)
        max_price = request.args.get('maxPrice', type=float)
        
        # Build SQL query
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
        
        # Execute query
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
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
            </style>
        </head>
        <body>
            <h1>Available Wares</h1>
            <table>
                <tr>
                    <th>Ware Name</th>
                    <th>Price</th>
                    <th>Description</th>
                    <th>Merchant Email</th>
                </tr>
                {% for ware in wares %}
                <tr>
                    <td>{{ ware[0] }}</td>
                    <td>{{ ware[1] }}</td>
                    <td>{{ ware[2] }}</td>
                    <td>{{ ware[3] }}</td>
                </tr>
                {% endfor %}
            </table>
        </body>
        </html>
        '''
        
        return render_template_string(html_template, wares=wares), 200
        
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)