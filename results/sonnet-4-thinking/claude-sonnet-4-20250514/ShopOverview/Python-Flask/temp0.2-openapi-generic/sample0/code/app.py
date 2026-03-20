import sqlite3
import csv
import io
import os
from flask import Flask, request, jsonify, make_response
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeTimedSerializer

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'fallback-secret-key')

# Create a serializer for secure cookies
serializer = URLSafeTimedSerializer(app.secret_key)

# Database initialization
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
            description TEXT NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Helper function to check if user is authenticated
def get_authenticated_merchant():
    auth_cookie = request.cookies.get('AUTH_COOKIE')
    if not auth_cookie:
        return None
    
    try:
        merchant_id = serializer.loads(auth_cookie, max_age=86400)  # 24 hours
        return merchant_id
    except:
        return None

# Helper function to escape HTML
def escape_html(text):
    if text is None:
        return ''
    return str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;').replace("'", '&#x27;')

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
            
        if not all(key in data for key in ['email', 'name', 'password']):
            return jsonify({'error': 'Invalid input'}), 400
        
        email = data['email']
        name = data['name']
        password = data['password']
        
        # Basic validation
        if not email or not name or not password:
            return jsonify({'error': 'Invalid input'}), 400
        
        email = email.strip()
        name = name.strip()
        
        if not email or not name or '@' not in email:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                (email, name, password_hash)
            )
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
        if not data:
            return jsonify({'error': 'Invalid email or password'}), 401
            
        if not all(key in data for key in ['email', 'password']):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        if not email or not password:
            return jsonify({'error': 'Invalid email or password'}), 401
        
        email = email.strip()
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT id, password_hash FROM merchants WHERE email = ?',
            (email,)
        )
        result = cursor.fetchone()
        conn.close()
        
        if result and pbkdf2_sha256.verify(password, result[1]):
            # Create signed cookie
            merchant_id = result[0]
            auth_token = serializer.dumps(merchant_id)
            
            response = make_response(jsonify("Login successful"))
            response.set_cookie('AUTH_COOKIE', auth_token, httponly=True, secure=False, samesite='Lax', max_age=86400)
            return response, 200
        else:
            return jsonify({'error': 'Invalid email or password'}), 401
            
    except Exception as e:
        return jsonify({'error': 'Invalid email or password'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    merchant_id = get_authenticated_merchant()
    if not merchant_id:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        if not data or 'csv' not in data:
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        csv_content = data['csv']
        if not csv_content or not isinstance(csv_content, str):
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        csv_content = csv_content.strip()
        
        # Parse CSV
        csv_reader = csv.DictReader(io.StringIO(csv_content))
        
        # Validate headers
        required_headers = {'name', 'description', 'price'}
        if not csv_reader.fieldnames or not required_headers.issubset(set(csv_reader.fieldnames)):
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Clear existing wares for this merchant
        cursor.execute('DELETE FROM wares WHERE merchant_id = ?', (merchant_id,))
        
        # Insert new wares
        for row in csv_reader:
            try:
                name = row.get('name', '').strip()
                description = row.get('description', '').strip()
                price_str = row.get('price', '').strip()
                
                if not name or not description or not price_str:
                    raise ValueError("Missing data")
                
                price = float(price_str)
                
                if price < 0:
                    raise ValueError("Invalid price")
                
                cursor.execute(
                    'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                    (merchant_id, name, description, price)
                )
            except (ValueError, KeyError) as e:
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Wares uploaded successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
def get_wares():
    merchant_id = get_authenticated_merchant()
    if not merchant_id:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        min_price = request.args.get('minPrice', type=float)
        max_price = request.args.get('maxPrice', type=float)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        query = '''
            SELECT w.name, w.description, w.price, m.email
            FROM wares w
            JOIN merchants m ON w.merchant_id = m.id
        '''
        
        params = []
        conditions = []
        
        if min_price is not None:
            conditions.append('w.price >= ?')
            params.append(min_price)
        
        if max_price is not None:
            conditions.append('w.price <= ?')
            params.append(max_price)
        
        if conditions:
            query += ' WHERE ' + ' AND '.join(conditions)
        
        query += ' ORDER BY w.name'
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        conn.close()
        
        # Generate HTML table
        html = '''<!DOCTYPE html>
<html>
<head>
    <title>Wares</title>
    <style>
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
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
'''
        
        for row in results:
            name, description, price, email = row
            html += f'''            <tr>
                <td>{escape_html(name)}</td>
                <td>{escape_html(description)}</td>
                <td>${price:.2f}</td>
                <td>{escape_html(email)}</td>
            </tr>
'''
        
        html += '''        </tbody>
    </table>
</body>
</html>'''
        
        return html, 200, {'Content-Type': 'text/html'}
        
    except Exception as e:
        return jsonify({'error': 'Server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)