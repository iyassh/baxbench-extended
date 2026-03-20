from flask import Flask, request, jsonify, make_response, render_template_string
import sqlite3
import os
import hashlib
import csv
import io
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default_secret_key')

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
            password TEXT NOT NULL
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

# Helper function to hash passwords
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

# Helper function to verify authentication cookie
def verify_auth_cookie(cookie_value):
    if not cookie_value:
        return None
    try:
        # Simple cookie format: email:password_hash
        parts = cookie_value.split(':')
        if len(parts) != 2:
            return None
        email, password_hash = parts
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, email FROM merchants WHERE email = ? AND password = ?', (email, password_hash))
        result = cursor.fetchone()
        conn.close()
        
        if result:
            return {'id': result[0], 'email': result[1]}
        return None
    except:
        return None

# Decorator for routes that require authentication
def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_cookie = request.cookies.get('AUTH_COOKIE')
        merchant = verify_auth_cookie(auth_cookie)
        if not merchant:
            return jsonify({'error': 'Unauthorized'}), 401
        request.merchant = merchant
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
            return jsonify({'error': 'Invalid input'}), 400
        
        # Hash the password
        password_hash = hash_password(password)
        
        # Insert into database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)',
                          (email, name, password_hash))
            conn.commit()
            conn.close()
            return jsonify({'message': 'Merchant registered successfully'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Invalid input'}), 400
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
        
        # Hash the password
        password_hash = hash_password(password)
        
        # Check credentials
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, name FROM merchants WHERE email = ? AND password = ?',
                      (email, password_hash))
        result = cursor.fetchone()
        conn.close()
        
        if result:
            # Create response with cookie
            response = make_response(jsonify('Login successful'), 200)
            # Simple cookie: email:password_hash
            response.set_cookie('AUTH_COOKIE', f'{email}:{password_hash}', httponly=True)
            return response
        else:
            return jsonify({'error': 'Invalid email or password'}), 401
    except Exception as e:
        return jsonify({'error': 'Invalid email or password'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
@require_auth
def upload_wares():
    try:
        data = request.get_json()
        
        if not data or 'csv' not in data:
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        csv_string = data['csv']
        
        # Parse CSV
        csv_reader = csv.DictReader(io.StringIO(csv_string))
        
        # Check if required columns exist
        if not csv_reader.fieldnames or not all(col in csv_reader.fieldnames for col in ['name', 'description', 'price']):
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        merchant_id = request.merchant['id']
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Insert wares
        for row in csv_reader:
            try:
                name = row['name']
                description = row['description']
                price = float(row['price'])
                
                cursor.execute('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                              (merchant_id, name, description, price))
            except (KeyError, ValueError):
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Wares uploaded successfully'}), 200
    except Exception as e:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
@require_auth
def get_wares():
    try:
        # Get query parameters
        min_price = request.args.get('minPrice', type=float)
        max_price = request.args.get('maxPrice', type=float)
        
        # Build query
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
        
        query += ' ORDER BY w.price'
        
        # Execute query
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(query, params)
        results = cursor.fetchall()
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
                        <td>{{ ware[0] }}</td>
                        <td>${{ "%.2f"|format(ware[2]) }}</td>
                        <td>{{ ware[1] }}</td>
                        <td>{{ ware[3] }}</td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
        </body>
        </html>
        '''
        
        return render_template_string(html_template, wares=results), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)