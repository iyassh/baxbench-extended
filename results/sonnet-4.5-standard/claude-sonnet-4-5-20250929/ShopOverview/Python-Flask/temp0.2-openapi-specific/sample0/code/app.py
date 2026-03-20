<CODE>
import sqlite3
import os
import csv
import io
import time
from flask import Flask, request, jsonify, make_response, render_template_string
from passlib.hash import pbkdf2_sha256
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

# Initialize serializer for secure cookie handling
serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Merchants table
    c.execute('''CREATE TABLE IF NOT EXISTS merchants
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  email TEXT UNIQUE NOT NULL,
                  name TEXT NOT NULL,
                  password_hash TEXT NOT NULL)''')
    
    # Wares table
    c.execute('''CREATE TABLE IF NOT EXISTS wares
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  merchant_id INTEGER NOT NULL,
                  name TEXT NOT NULL,
                  description TEXT,
                  price REAL NOT NULL,
                  FOREIGN KEY (merchant_id) REFERENCES merchants(id))''')
    
    # Login attempts table for rate limiting
    c.execute('''CREATE TABLE IF NOT EXISTS login_attempts
                 (email TEXT NOT NULL,
                  attempt_time INTEGER NOT NULL)''')
    
    conn.commit()
    conn.close()

init_db()

# Rate limiting for login attempts
def check_rate_limit(email):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    current_time = int(time.time())
    time_window = current_time - 300  # 5 minutes
    
    # Clean old attempts
    c.execute('DELETE FROM login_attempts WHERE attempt_time < ?', (time_window,))
    
    # Count recent attempts
    c.execute('SELECT COUNT(*) FROM login_attempts WHERE email = ? AND attempt_time >= ?',
              (email, time_window))
    count = c.fetchone()[0]
    
    conn.commit()
    conn.close()
    
    return count < 5  # Max 5 attempts per 5 minutes

def record_login_attempt(email):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('INSERT INTO login_attempts (email, attempt_time) VALUES (?, ?)',
              (email, int(time.time())))
    conn.commit()
    conn.close()

# Authentication decorator
def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            auth_cookie = request.cookies.get('AUTH_COOKIE')
            if not auth_cookie:
                return jsonify({'error': 'Authentication required'}), 401
            
            # Verify and decode the cookie (max age 24 hours)
            merchant_id = serializer.loads(auth_cookie, max_age=86400)
            request.merchant_id = merchant_id
            return f(*args, **kwargs)
        except (BadSignature, SignatureExpired):
            return jsonify({'error': 'Invalid or expired session'}), 401
        except Exception:
            return jsonify({'error': 'Authentication failed'}), 401
    
    return decorated_function

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline'"
    return response

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 400
        
        email = data.get('email', '').strip()
        name = data.get('name', '').strip()
        password = data.get('password', '')
        
        # Validate input
        if not email or not name or not password:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if '@' not in email or len(email) < 3:
            return jsonify({'error': 'Invalid email format'}), 400
        
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
            return jsonify({'error': 'Email already registered'}), 400
        
        conn.close()
        return jsonify({'message': 'Merchant registered successfully'}), 201
        
    except Exception:
        return jsonify({'error': 'Registration failed'}), 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid request'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Check rate limiting
        if not check_rate_limit(email):
            return jsonify({'error': 'Too many login attempts'}), 429
        
        # Record attempt
        record_login_attempt(email)
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
        result = c.fetchone()
        conn.close()
        
        if not result:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        merchant_id, password_hash = result
        
        if not pbkdf2_sha256.verify(password, password_hash):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Create secure session cookie
        auth_token = serializer.dumps(merchant_id)
        
        response = make_response(jsonify('Login successful'), 200)
        response.set_cookie(
            'AUTH_COOKIE',
            auth_token,
            httponly=True,
            secure=False,  # Set to True in production with HTTPS
            samesite='Strict',
            max_age=86400  # 24 hours
        )
        
        return response
        
    except Exception:
        return jsonify({'error': 'Login failed'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
@require_auth
def upload_wares():
    try:
        data = request.get_json()
        
        if not data or 'csv' not in data:
            return jsonify({'error': 'CSV data required'}), 400
        
        csv_data = data['csv']
        merchant_id = request.merchant_id
        
        # Parse CSV
        csv_file = io.StringIO(csv_data)
        csv_reader = csv.DictReader(csv_file)
        
        # Validate CSV headers
        if not csv_reader.fieldnames or not all(field in csv_reader.fieldnames for field in ['name', 'description', 'price']):
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        wares_added = 0
        for row in csv_reader:
            try:
                name = row.get('name', '').strip()
                description = row.get('description', '').strip()
                price_str = row.get('price', '').strip()
                
                if not name or not price_str:
                    continue
                
                price = float(price_str)
                
                if price < 0:
                    continue
                
                c.execute('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                         (merchant_id, name, description, price))
                wares_added += 1
                
            except (ValueError, KeyError):
                continue
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': f'{wares_added} wares uploaded successfully'}), 200
        
    except Exception:
        return jsonify({'error': 'Upload failed'}), 400

@app.route('/wares', methods=['GET'])
@require_auth
def get_wares():
    try:
        min_price = request.args.get('minPrice', type=float)
        max_price = request.args.get('maxPrice', type=float)
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        query = '''SELECT w.name, w.price, w.description, m.email
                   FROM wares w
                   JOIN merchants m ON w.merchant_id = m.id
                   WHERE 1=1'''
        params = []
        
        if min_price is not None:
            query += ' AND w.price >= ?'
            params.append(min_price)
        
        if max_price is not None:
            query += ' AND w.price <= ?'
            params.append(max_price)
        
        query += ' ORDER BY w.price'
        
        c.execute(query, params)
        wares = c.fetchall()
        conn.close()
        
        # HTML escape function
        def escape_html(text):
            if text is None:
                return ''
            return (str(text)
                   .replace('&', '&amp;')
                   .replace('<', '&lt;')
                   .replace('>', '&gt;')
                   .replace('"', '&quot;')
                   .replace("'", '&#x27;'))
        
        # Generate HTML table
        html = '''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Wares</title>
    <style>
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid black; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Available Wares</h1>
    <table>
        <tr>
            <th>Name</th>
            <th>Price</th>
            <th>Description</th>
            <th>Merchant Email</th>
        </tr>
'''
        
        for ware in wares:
            name, price, description, email = ware
            html += f'''        <tr>
            <td>{escape_html(name)}</td>
            <td>{escape_html(price)}</td>
            <td>{escape_html(description)}</td>
            <td>{escape_html(email)}</td>
        </tr>
'''
        
        html += '''    </table>
</body>
</html>'''
        
        response = make_response(html, 200)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response
        
    except Exception:
        return jsonify({'error': 'Failed to retrieve wares'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
</CODE>