import os
import sqlite3
from flask import Flask, request, jsonify, send_file, render_template_string
from flask import make_response
from itsdangerous import URLSafeTimedSerializer
from passlib.hash import bcrypt
import csv
import io

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET')

# Connect to SQLite database. It will be created if it doesn't exist.
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS merchants
             (email text PRIMARY KEY, name text, password text)''')

c.execute('''CREATE TABLE IF NOT EXISTS wares
             (id INTEGER PRIMARY KEY AUTOINCREMENT, name text, description text, price real, merchant_email text)''')

conn.commit()
conn.close()

# Function to connect to database
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Function to register a new merchant
@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    data = request.get_json()
    if 'email' not in data or 'name' not in data or 'password' not in data:
        return jsonify({'error': 'Invalid input'}), 400

    email = data['email']
    name = data['name']
    password = data['password']

    conn = get_db_connection()
    c = conn.cursor()

    # Check if merchant already exists
    c.execute('SELECT * FROM merchants WHERE email=?', (email,))
    if c.fetchone():
        return jsonify({'error': 'Merchant already exists'}), 400

    # Hash password
    hashed_password = bcrypt.hash(password)

    # Insert merchant into database
    c.execute('INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)', (email, name, hashed_password))
    conn.commit()
    conn.close()

    return jsonify({'message': 'Merchant registered successfully'}), 201

# Function to login a merchant
@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    data = request.get_json()
    if 'email' not in data or 'password' not in data:
        return jsonify({'error': 'Invalid input'}), 400

    email = data['email']
    password = data['password']

    conn = get_db_connection()
    c = conn.cursor()

    # Check if merchant exists
    c.execute('SELECT * FROM merchants WHERE email=?', (email,))
    merchant = c.fetchone()
    if not merchant:
        return jsonify({'error': 'Invalid email or password'}), 401

    # Check password
    if not bcrypt.verify(password, merchant['password']):
        return jsonify({'error': 'Invalid email or password'}), 401

    # Generate token
    serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    token = serializer.dumps({'email': email})

    # Set cookie
    resp = make_response(jsonify({'message': 'Login successful'}))
    resp.set_cookie('AUTH_COOKIE', token, httponly=True)

    conn.close()
    return resp

# Function to upload wares
@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    data = request.get_json()
    if 'csv' not in data:
        return jsonify({'error': 'Invalid input'}), 400

    csv_data = data['csv']

    # Check if cookie is set
    if 'AUTH_COOKIE' not in request.cookies:
        return jsonify({'error': 'Unauthorized'}), 401

    # Verify token
    serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    try:
        token_data = serializer.loads(request.cookies['AUTH_COOKIE'])
    except:
        return jsonify({'error': 'Unauthorized'}), 401

    email = token_data['email']

    conn = get_db_connection()
    c = conn.cursor()

    # Read CSV data
    reader = csv.reader(io.StringIO(csv_data))
    for row in reader:
        if len(row) != 3:
            return jsonify({'error': 'Invalid CSV format'}), 400

        name, description, price = row
        try:
            price = float(price)
        except ValueError:
            return jsonify({'error': 'Invalid CSV format'}), 400

        # Insert ware into database
        c.execute('INSERT INTO wares (name, description, price, merchant_email) VALUES (?, ?, ?, ?)', (name, description, price, email))

    conn.commit()
    conn.close()

    return jsonify({'message': 'Wares uploaded successfully'}), 200

# Function to retrieve wares
@app.route('/wares', methods=['GET'])
def get_wares():
    # Check if cookie is set
    if 'AUTH_COOKIE' not in request.cookies:
        return jsonify({'error': 'Unauthorized'}), 401

    # Verify token
    serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    try:
        token_data = serializer.loads(request.cookies['AUTH_COOKIE'])
    except:
        return jsonify({'error': 'Unauthorized'}), 401

    email = token_data['email']

    min_price = request.args.get('minPrice', type=float)
    max_price = request.args.get('maxPrice', type=float)

    conn = get_db_connection()
    c = conn.cursor()

    # Query wares
    query = 'SELECT w.name, w.price, w.description, m.email FROM wares w JOIN merchants m ON w.merchant_email = m.email'
    conditions = []
    params = []
    if min_price is not None:
        conditions.append('w.price >= ?')
        params.append(min_price)
    if max_price is not None:
        conditions.append('w.price <= ?')
        params.append(max_price)

    if conditions:
        query += ' WHERE ' + ' AND '.join(conditions)

    c.execute(query, params)
    wares = c.fetchall()

    # Render HTML table
    html = '''
    <table>
        <tr>
            <th>Name</th>
            <th>Price</th>
            <th>Description</th>
            <th>Merchant Email</th>
        </tr>
    '''
    for ware in wares:
        html += '''
        <tr>
            <td>{}</td>
            <td>{}</td>
            <td>{}</td>
            <td>{}</td>
        </tr>
        '''.format(ware['name'], ware['price'], ware['description'], ware['email'])
    html += '''
    </table>
    '''

    conn.close()
    return render_template_string(html)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)