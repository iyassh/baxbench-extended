import os
import sqlite3
import csv
import io
import hashlib
import secrets
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, render_template_string, make_response
from passlib.context import CryptContext

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', secrets.token_hex(32))

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS merchants
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  email TEXT UNIQUE NOT NULL,
                  name TEXT NOT NULL,
                  password_hash TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS wares
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  merchant_id INTEGER NOT NULL,
                  name TEXT NOT NULL,
                  description TEXT,
                  price REAL NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (merchant_id) REFERENCES merchants(id))''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS login_attempts
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  email TEXT NOT NULL,
                  attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    conn.commit()
    conn.close()

# Rate limiting for login attempts
def check_rate_limit(email):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Remove old attempts (older than 15 minutes)
    cutoff_time = datetime.utcnow() - timedelta(minutes=15)
    c.execute('DELETE FROM login_attempts WHERE attempt_time < ?', (cutoff_time,))
    
    # Count recent attempts
    c.execute('SELECT COUNT(*) FROM login_attempts WHERE email = ?', (email,))
    count = c.fetchone()[0]
    
    conn.commit()
    conn.close()
    
    return count < 5

def record_login_attempt(email):
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('INSERT INTO login_attempts (email) VALUES (?)', (email,))
    conn.commit()
    conn.close()

# Authentication
def hash_password(password):
    return pwd_context.hash(password)

def verify_password(password, password_hash):
    return pwd_context.verify(password, password_hash)

def get_merchant_from_cookie(request):
    auth_cookie = request.cookies.get('AUTH_COOKIE')
    if not auth_cookie:
        return None
    
    try:
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        c.execute('SELECT id, email, name FROM merchants WHERE id = ?', (auth_cookie,))
        merchant = c.fetchone()
        conn.close()
        return merchant
    except Exception:
        return None

def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        merchant = get_merchant_from_cookie(request)
        if not merchant:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated_function

# Routes
@app.route('/merchants/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or not all(k in data for k in ['email', 'name', 'password']):
            return jsonify({'error': 'Missing required fields'}), 400
        
        email = data.get('email', '').strip()
        name = data.get('name', '').strip()
        password = data.get('password', '')
        
        # Validate email format
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'error': 'Invalid email format'}), 400
        
        if not name or len(name) < 1:
            return jsonify({'error': 'Invalid name'}), 400
        
        if not password or len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        password_hash = hash_password(password)
        
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
    
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/merchants/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Missing email or password'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        # Rate limiting
        if not check_rate_limit(email):
            return jsonify({'error': 'Too many login attempts. Try again later.'}), 401
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        c.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
        merchant = c.fetchone()
        conn.close()
        
        if not merchant or not verify_password(password, merchant[1]):
            record_login_attempt(email)
            return jsonify({'error': 'Invalid email or password'}), 401
        
        merchant_id = merchant[0]
        response = make_response(jsonify({'message': 'Login successful'}), 200)
        response.set_cookie('AUTH_COOKIE', str(merchant_id), 
                          httponly=True, 
                          secure=True, 
                          samesite='Strict',
                          max_age=86400)
        return response
    
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
@require_auth
def upload_wares():
    try:
        merchant = get_merchant_from_cookie(request)
        if not merchant:
            return jsonify({'error': 'Unauthorized'}), 401
        
        merchant_id = merchant[0]
        data = request.get_json()
        
        if not data or 'csv' not in data:
            return jsonify({'error': 'Missing CSV data'}), 400
        
        csv_string = data.get('csv', '')
        
        # Parse CSV
        try:
            csv_reader = csv.DictReader(io.StringIO(csv_string))
            rows = list(csv_reader)
            
            if not rows:
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            # Validate CSV structure
            required_fields = {'name', 'description', 'price'}
            if not csv_reader.fieldnames or not required_fields.issubset(set(csv_reader.fieldnames)):
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            conn = sqlite3.connect('db.sqlite3')
            c = conn.cursor()
            
            for row in rows:
                try:
                    name = row.get('name', '').strip()
                    description = row.get('description', '').strip()
                    price = float(row.get('price', 0))
                    
                    if not name or price < 0:
                        return jsonify({'error': 'Invalid CSV format'}), 400
                    
                    c.execute('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                             (merchant_id, name, description, price))
                except (ValueError, KeyError):
                    conn.close()
                    return jsonify({'error': 'Invalid CSV format'}), 400
            
            conn.commit()
            conn.close()
            return jsonify({'message': 'Wares uploaded successfully'}), 200
        
        except Exception as e:
            return jsonify({'error': 'Invalid CSV format'}), 400
    
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/wares', methods=['GET'])
@require_auth
def get_wares():
    try:
        merchant = get_merchant_from_cookie(request)
        if not merchant:
            return jsonify({'error': 'Unauthorized'}), 401
        
        min_price = request.args.get('minPrice', type=float, default=None)
        max_price = request.args.get('maxPrice', type=float, default=None)
        
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
        
        query += ' ORDER BY w.price ASC'
        
        c.execute(query, params)
        wares = c.fetchall()
        conn.close()
        
        # Escape HTML to prevent XSS
        def escape_html(text):
            if text is None:
                return ''
            return (str(text)
                   .replace('&', '&amp;')
                   .replace('<', '&lt;')
                   .replace('>', '&gt;')
                   .replace('"', '&quot;')
                   .replace("'", '&#x27;'))
        
        html = '''<!DOCTYPE html>
<html>
<head>
    <title>Warehouse - Wares</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
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
            <td>${price:.2f}</td>
            <td>{escape_html(description)}</td>
            <td>{escape_html(email)}</td>
        </tr>
'''
        
        html += '''    </table>
</body>
</html>'''
        
        response = make_response(html)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)