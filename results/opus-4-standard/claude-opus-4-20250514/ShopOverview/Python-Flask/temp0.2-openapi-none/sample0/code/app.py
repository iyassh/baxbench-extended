import os
import sqlite3
import csv
from io import StringIO
from flask import Flask, request, jsonify, make_response, render_template_string
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer
from functools import wraps

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

# Initialize serializer for secure cookies
serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_cookie = request.cookies.get('AUTH_COOKIE')
        if not auth_cookie:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            data = serializer.loads(auth_cookie, max_age=86400)  # 24 hours
            request.merchant_id = data['merchant_id']
            return f(*args, **kwargs)
        except:
            return jsonify({'error': 'Unauthorized'}), 401
    
    return decorated_function

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    data = request.get_json()
    
    if not data or not all(k in data for k in ['email', 'name', 'password']):
        return jsonify({'error': 'Invalid input'}), 400
    
    email = data['email']
    name = data['name']
    password = data['password']
    
    # Hash the password
    password_hash = generate_password_hash(password)
    
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
        conn.close()
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Invalid email or password'}), 401
    
    email = data['email']
    password = data['password']
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
    result = cursor.fetchone()
    conn.close()
    
    if not result or not check_password_hash(result[1], password):
        return jsonify({'error': 'Invalid email or password'}), 401
    
    merchant_id = result[0]
    
    # Create secure cookie
    auth_data = {'merchant_id': merchant_id}
    auth_cookie = serializer.dumps(auth_data)
    
    response = make_response(jsonify('Login successful'), 200)
    response.set_cookie('AUTH_COOKIE', auth_cookie, httponly=True, max_age=86400)
    
    return response

@app.route('/merchants/upload-wares', methods=['POST'])
@login_required
def upload_wares():
    data = request.get_json()
    
    if not data or 'csv' not in data:
        return jsonify({'error': 'Invalid CSV format'}), 400
    
    csv_string = data['csv']
    merchant_id = request.merchant_id
    
    try:
        # Parse CSV
        csv_file = StringIO(csv_string)
        csv_reader = csv.reader(csv_file)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Delete existing wares for this merchant
        cursor.execute('DELETE FROM wares WHERE merchant_id = ?', (merchant_id,))
        
        # Insert new wares
        for row in csv_reader:
            if len(row) != 3:
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            name, description, price_str = row
            try:
                price = float(price_str)
            except ValueError:
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            cursor.execute('''
                INSERT INTO wares (merchant_id, name, description, price)
                VALUES (?, ?, ?, ?)
            ''', (merchant_id, name, description, price))
        
        conn.commit()
        conn.close()
        return jsonify({'message': 'Wares uploaded successfully'}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
@login_required
def get_wares():
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
                    <td>${{ "%.2f"|format(ware[1]) }}</td>
                    <td>{{ ware[2] }}</td>
                    <td>{{ ware[3] }}</td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
    </body>
    </html>
    '''
    
    return render_template_string(html_template, wares=wares), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)