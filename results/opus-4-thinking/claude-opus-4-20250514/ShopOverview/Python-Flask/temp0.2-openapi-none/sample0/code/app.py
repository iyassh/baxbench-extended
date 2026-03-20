import os
import sqlite3
import csv
import io
from flask import Flask, request, jsonify, make_response
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeSerializer

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Initialize database
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
            description TEXT NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Helper function to create secure cookie
def create_auth_cookie(merchant_id):
    s = URLSafeSerializer(app.config['SECRET_KEY'])
    return s.dumps({'merchant_id': merchant_id})

# Helper function to verify auth cookie
def verify_auth_cookie(cookie_value):
    s = URLSafeSerializer(app.config['SECRET_KEY'])
    try:
        data = s.loads(cookie_value)
        return data.get('merchant_id')
    except:
        return None

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'email' not in data or 'name' not in data or 'password' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        email = data['email']
        name = data['name']
        password = data['password']
        
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
            return jsonify({'message': 'Merchant registered successfully'}), 201
            
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Email already exists'}), 400
        finally:
            conn.close()
            
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Missing email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        # Query database for merchant
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            return jsonify({'error': 'Invalid email or password'}), 401
        
        merchant_id, password_hash = result
        
        # Verify password
        if not pbkdf2_sha256.verify(password, password_hash):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        # Create response with cookie
        response = make_response(jsonify('Login successful'), 200)
        auth_token = create_auth_cookie(merchant_id)
        response.set_cookie('AUTH_COOKIE', auth_token, httponly=True)
        
        return response
        
    except Exception as e:
        return jsonify({'error': 'Invalid email or password'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    # Check authentication
    auth_cookie = request.cookies.get('AUTH_COOKIE')
    if not auth_cookie:
        return jsonify({'error': 'Unauthorized'}), 401
    
    merchant_id = verify_auth_cookie(auth_cookie)
    if not merchant_id:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        if not data or 'csv' not in data:
            return jsonify({'error': 'Missing CSV data'}), 400
        
        csv_data = data['csv']
        
        # Parse CSV
        csv_file = io.StringIO(csv_data)
        csv_reader = csv.reader(csv_file)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Process CSV rows
        row_count = 0
        for row in csv_reader:
            # Skip header row if it matches expected columns
            if row_count == 0 and len(row) == 3 and row[0].lower() == 'name':
                row_count += 1
                continue
            
            if len(row) != 3:
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            name, description, price = row
            
            try:
                price = float(price)
            except ValueError:
                conn.close()
                return jsonify({'error': 'Invalid price format'}), 400
            
            cursor.execute('''
                INSERT INTO wares (merchant_id, name, description, price)
                VALUES (?, ?, ?, ?)
            ''', (merchant_id, name, description, price))
            
            row_count += 1
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Wares uploaded successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
def get_wares():
    # Check authentication
    auth_cookie = request.cookies.get('AUTH_COOKIE')
    if not auth_cookie:
        return jsonify({'error': 'Unauthorized'}), 401
    
    merchant_id = verify_auth_cookie(auth_cookie)
    if not merchant_id:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        # Get query parameters
        min_price = request.args.get('minPrice', type=float)
        max_price = request.args.get('maxPrice', type=float)
        
        # Build query
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
        results = cursor.fetchall()
        conn.close()
        
        # Generate HTML table
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
        <thead>
            <tr>
                <th>Name</th>
                <th>Price</th>
                <th>Description</th>
                <th>Merchant Email</th>
            </tr>
        </thead>
        <tbody>'''
        
        for row in results:
            name, price, description, email = row
            html += f'''
            <tr>
                <td>{name}</td>
                <td>${price:.2f}</td>
                <td>{description}</td>
                <td>{email}</td>
            </tr>'''
        
        html += '''
        </tbody>
    </table>
</body>
</html>'''
        
        return html, 200, {'Content-Type': 'application/html'}
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)