import os
import sqlite3
import csv
import io
from flask import Flask, request, jsonify, make_response, render_template_string
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

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

# Helper function to get merchant from cookie
def get_merchant_from_cookie():
    auth_cookie = request.cookies.get('AUTH_COOKIE')
    if not auth_cookie:
        return None
    
    try:
        serializer = URLSafeTimedSerializer(app.secret_key)
        merchant_email = serializer.loads(auth_cookie, max_age=3600)  # 1 hour expiry
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, name FROM merchants WHERE email = ?', (merchant_email,))
        merchant = cursor.fetchone()
        conn.close()
        
        if merchant:
            return {'id': merchant[0], 'email': merchant[1], 'name': merchant[2]}
        return None
    except:
        return None

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    data = request.get_json()
    
    if not data or not all(k in data for k in ('email', 'name', 'password')):
        return jsonify({'error': 'Missing required fields'}), 400
    
    email = data['email']
    name = data['name']
    password = data['password']
    
    # Hash password
    password_hash = generate_password_hash(password)
    
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                      (email, name, password_hash))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Merchant registered successfully'}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already exists'}), 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    data = request.get_json()
    
    if not data or not all(k in data for k in ('email', 'password')):
        return jsonify({'error': 'Missing email or password'}), 400
    
    email = data['email']
    password = data['password']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('SELECT password_hash FROM merchants WHERE email = ?', (email,))
    result = cursor.fetchone()
    conn.close()
    
    if result and check_password_hash(result[0], password):
        # Create auth cookie
        serializer = URLSafeTimedSerializer(app.secret_key)
        auth_token = serializer.dumps(email)
        
        response = make_response(jsonify('Login successful'))
        response.set_cookie('AUTH_COOKIE', auth_token, httponly=True)
        return response
    else:
        return jsonify({'error': 'Invalid email or password'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    merchant = get_merchant_from_cookie()
    if not merchant:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    if not data or 'csv' not in data:
        return jsonify({'error': 'Missing CSV data'}), 400
    
    csv_data = data['csv']
    
    try:
        # Parse CSV
        csv_reader = csv.DictReader(io.StringIO(csv_data))
        wares = []
        
        for row in csv_reader:
            if not all(k in row for k in ('name', 'description', 'price')):
                return jsonify({'error': 'Invalid CSV format - missing required columns'}), 400
            
            try:
                price = float(row['price'])
            except ValueError:
                return jsonify({'error': 'Invalid price format'}), 400
            
            wares.append((merchant['id'], row['name'], row['description'], price))
        
        # Insert wares into database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Clear existing wares for this merchant
        cursor.execute('DELETE FROM wares WHERE merchant_id = ?', (merchant['id'],))
        
        # Insert new wares
        cursor.executemany('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)', wares)
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Wares uploaded successfully'}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
def get_wares():
    merchant = get_merchant_from_cookie()
    if not merchant:
        return jsonify({'error': 'Unauthorized'}), 401
    
    min_price = request.args.get('minPrice', type=float)
    max_price = request.args.get('maxPrice', type=float)
    
    conn = sqlite3.connect('db.sqlite3')
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
    
    # Generate HTML table
    html_template = '''
    <!DOCTYPE html>
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
                {% for ware in wares %}
                <tr>
                    <td>{{ ware[0] }}</td>
                    <td>{{ ware[1] }}</td>
                    <td>${{ "%.2f"|format(ware[2]) }}</td>
                    <td>{{ ware[3] }}</td>
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
    app.run(host='0.0.0.0', port=5000, debug=True)