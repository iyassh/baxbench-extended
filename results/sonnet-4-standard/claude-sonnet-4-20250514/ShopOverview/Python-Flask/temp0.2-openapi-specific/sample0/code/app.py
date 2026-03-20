import sqlite3
import csv
import io
import os
import time
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, make_response, render_template_string
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeTimedSerializer
import html

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'fallback-secret-key')

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Rate limiting storage
login_attempts = {}

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS merchants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            price REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def create_auth_token(merchant_id):
    serializer = URLSafeTimedSerializer(app.secret_key)
    return serializer.dumps({'merchant_id': merchant_id})

def verify_auth_token(token):
    try:
        serializer = URLSafeTimedSerializer(app.secret_key)
        data = serializer.loads(token, max_age=86400)  # 24 hours
        return data.get('merchant_id')
    except:
        return None

def check_rate_limit(email):
    now = time.time()
    if email in login_attempts:
        attempts, last_attempt = login_attempts[email]
        if now - last_attempt < 300:  # 5 minutes
            if attempts >= 5:
                return False
        else:
            login_attempts[email] = (0, now)
    else:
        login_attempts[email] = (0, now)
    return True

def record_failed_attempt(email):
    now = time.time()
    if email in login_attempts:
        attempts, _ = login_attempts[email]
        login_attempts[email] = (attempts + 1, now)
    else:
        login_attempts[email] = (1, now)

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        email = data.get('email', '').strip()
        name = data.get('name', '').strip()
        password = data.get('password', '')
        
        if not email or not name or not password:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if '@' not in email or len(email) > 254:
            return jsonify({'error': 'Invalid email format'}), 400
        
        if len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
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
            
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Missing email or password'}), 401
        
        if not check_rate_limit(email):
            return jsonify({'error': 'Too many failed attempts. Try again later.'}), 429
        
        conn = get_db_connection()
        try:
            merchant = conn.execute(
                'SELECT id, password_hash FROM merchants WHERE email = ?',
                (email,)
            ).fetchone()
            
            if not merchant or not pbkdf2_sha256.verify(password, merchant['password_hash']):
                record_failed_attempt(email)
                return jsonify({'error': 'Invalid email or password'}), 401
            
            # Reset failed attempts on successful login
            if email in login_attempts:
                del login_attempts[email]
            
            token = create_auth_token(merchant['id'])
            response = make_response(jsonify('Login successful'))
            response.set_cookie(
                'AUTH_COOKIE', 
                token, 
                httponly=True, 
                secure=False,  # Set to True in production with HTTPS
                samesite='Strict',
                max_age=86400
            )
            return response
            
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    try:
        auth_cookie = request.cookies.get('AUTH_COOKIE')
        if not auth_cookie:
            return jsonify({'error': 'Authentication required'}), 401
        
        merchant_id = verify_auth_token(auth_cookie)
        if not merchant_id:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        data = request.get_json()
        if not data or 'csv' not in data:
            return jsonify({'error': 'CSV data required'}), 400
        
        csv_data = data['csv']
        if not isinstance(csv_data, str):
            return jsonify({'error': 'CSV must be a string'}), 400
        
        # Parse CSV
        csv_reader = csv.DictReader(io.StringIO(csv_data))
        
        required_columns = {'name', 'description', 'price'}
        if not required_columns.issubset(set(csv_reader.fieldnames or [])):
            return jsonify({'error': 'CSV must contain columns: name, description, price'}), 400
        
        wares_to_insert = []
        for row_num, row in enumerate(csv_reader, start=2):
            try:
                name = row['name'].strip()
                description = row['description'].strip()
                price = float(row['price'])
                
                if not name or not description or price < 0:
                    return jsonify({'error': f'Invalid data in row {row_num}'}), 400
                
                wares_to_insert.append((merchant_id, name, description, price))
                
            except (ValueError, KeyError):
                return jsonify({'error': f'Invalid data format in row {row_num}'}), 400
        
        if not wares_to_insert:
            return jsonify({'error': 'No valid wares found in CSV'}), 400
        
        # Insert wares into database
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.executemany(
                'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                wares_to_insert
            )
            conn.commit()
            return jsonify({'message': 'Wares uploaded successfully'}), 200
        finally:
            conn.close()
            
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/wares', methods=['GET'])
def get_wares():
    try:
        auth_cookie = request.cookies.get('AUTH_COOKIE')
        if not auth_cookie:
            return 'Authentication required', 401
        
        merchant_id = verify_auth_token(auth_cookie)
        if not merchant_id:
            return 'Invalid or expired token', 401
        
        min_price = request.args.get('minPrice', type=float)
        max_price = request.args.get('maxPrice', type=float)
        
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
        
        conn = get_db_connection()
        try:
            wares = conn.execute(query, params).fetchall()
            
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
                            <td>{{ ware.name }}</td>
                            <td>{{ ware.description }}</td>
                            <td>${{ "%.2f"|format(ware.price) }}</td>
                            <td>{{ ware.email }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </body>
            </html>
            '''
            
            # Escape HTML to prevent XSS
            escaped_wares = []
            for ware in wares:
                escaped_wares.append({
                    'name': html.escape(str(ware['name'])),
                    'description': html.escape(str(ware['description'])),
                    'price': ware['price'],
                    'email': html.escape(str(ware['email']))
                })
            
            return render_template_string(html_template, wares=escaped_wares)
            
        finally:
            conn.close()
            
    except Exception:
        return 'Internal server error', 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)