import os
import sqlite3
import csv
from io import StringIO
from functools import wraps
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, make_response, render_template_string
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeTimedSerializer

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Merchants table
    c.execute('''CREATE TABLE IF NOT EXISTS merchants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL
    )''')
    
    # Wares table
    c.execute('''CREATE TABLE IF NOT EXISTS wares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )''')
    
    # Login attempts tracking
    c.execute('''CREATE TABLE IF NOT EXISTS login_attempts (
        email TEXT NOT NULL,
        attempt_time DATETIME NOT NULL
    )''')
    
    conn.commit()
    conn.close()

init_db()

# Cookie serializer
serializer = URLSafeTimedSerializer(app.secret_key)

# Rate limiting for login
MAX_LOGIN_ATTEMPTS = 5
LOGIN_ATTEMPT_WINDOW = 300  # 5 minutes in seconds

def check_login_attempts(email):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    cutoff_time = datetime.now() - timedelta(seconds=LOGIN_ATTEMPT_WINDOW)
    c.execute('SELECT COUNT(*) FROM login_attempts WHERE email = ? AND attempt_time > ?',
              (email, cutoff_time))
    count = c.fetchone()[0]
    conn.close()
    return count < MAX_LOGIN_ATTEMPTS

def record_login_attempt(email):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('INSERT INTO login_attempts (email, attempt_time) VALUES (?, ?)',
              (email, datetime.now()))
    conn.commit()
    conn.close()

def cleanup_old_attempts():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    cutoff_time = datetime.now() - timedelta(seconds=LOGIN_ATTEMPT_WINDOW)
    c.execute('DELETE FROM login_attempts WHERE attempt_time < ?', (cutoff_time,))
    conn.commit()
    conn.close()

# Authentication decorator
def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            auth_cookie = request.cookies.get('AUTH_COOKIE')
            if not auth_cookie:
                return jsonify({'error': 'Unauthorized'}), 401
            
            merchant_id = serializer.loads(auth_cookie, max_age=3600)
            request.merchant_id = merchant_id
            return f(*args, **kwargs)
        except Exception:
            return jsonify({'error': 'Unauthorized'}), 401
    return decorated_function

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

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
        
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        try:
            c.execute('INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                      (email, name, password_hash))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Invalid input'}), 400
        
        conn.close()
        return jsonify({'message': 'Merchant registered successfully'}), 201
    except Exception:
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
        
        # Clean up old login attempts
        cleanup_old_attempts()
        
        # Check rate limiting
        if not check_login_attempts(email):
            return jsonify({'error': 'Too many login attempts'}), 401
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        c.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
        result = c.fetchone()
        conn.close()
        
        if not result:
            record_login_attempt(email)
            return jsonify({'error': 'Invalid email or password'}), 401
        
        merchant_id, password_hash = result
        
        if not pbkdf2_sha256.verify(password, password_hash):
            record_login_attempt(email)
            return jsonify({'error': 'Invalid email or password'}), 401
        
        # Create session cookie
        auth_token = serializer.dumps(merchant_id)
        response = make_response(jsonify('Login successful'), 200)
        response.set_cookie('AUTH_COOKIE', auth_token, httponly=True, samesite='Strict', secure=False)
        
        return response
    except Exception:
        return jsonify({'error': 'Invalid email or password'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
@require_auth
def upload_wares():
    try:
        data = request.get_json()
        
        if not data or 'csv' not in data:
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        csv_data = data['csv']
        merchant_id = request.merchant_id
        
        # Parse CSV
        csv_file = StringIO(csv_data)
        csv_reader = csv.DictReader(csv_file)
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        # Delete existing wares for this merchant
        c.execute('DELETE FROM wares WHERE merchant_id = ?', (merchant_id,))
        
        for row in csv_reader:
            if 'name' not in row or 'description' not in row or 'price' not in row:
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            name = row['name']
            description = row['description']
            try:
                price = float(row['price'])
            except (ValueError, TypeError):
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            c.execute('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                      (merchant_id, name, description, price))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Wares uploaded successfully'}), 200
    except Exception:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
@require_auth
def get_wares():
    try:
        min_price = request.args.get('minPrice', type=float)
        max_price = request.args.get('maxPrice', type=float)
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
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
        
        c.execute(query, params)
        wares = c.fetchall()
        conn.close()
        
        # Generate HTML table with proper escaping
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Wares</title>
        </head>
        <body>
            <table border="1">
                <tr>
                    <th>Name</th>
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
        
        html = render_template_string(html_template, wares=wares)
        response = make_response(html, 200)
        response.headers['Content-Type'] = 'text/html'
        return response
    except Exception:
        return jsonify({'error': 'Error retrieving wares'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)