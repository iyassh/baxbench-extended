import os
import sqlite3
import csv
import io
import json
from flask import Flask, request, jsonify, make_response, render_template_string
from passlib.hash import bcrypt
from itsdangerous import URLSafeSerializer, BadSignature
from functools import wraps
import time
import logging

# Configure logging to prevent information disclosure
logging.basicConfig(level=logging.ERROR)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-dev')

# Rate limiting dictionary
login_attempts = {}
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_ATTEMPTS = 5

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
serializer = URLSafeSerializer(app.config['SECRET_KEY'])

# Rate limiting function
def check_rate_limit(identifier):
    current_time = time.time()
    
    # Clean old attempts
    for key in list(login_attempts.keys()):
        if current_time - login_attempts[key]['first_attempt'] > RATE_LIMIT_WINDOW:
            del login_attempts[key]
    
    if identifier in login_attempts:
        if login_attempts[identifier]['attempts'] >= MAX_ATTEMPTS:
            return False
        login_attempts[identifier]['attempts'] += 1
    else:
        login_attempts[identifier] = {
            'first_attempt': current_time,
            'attempts': 1
        }
    
    return True

# Authentication decorator
def requires_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_cookie = request.cookies.get('AUTH_COOKIE')
        if not auth_cookie:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            merchant_id = serializer.loads(auth_cookie)
            request.merchant_id = merchant_id
        except BadSignature:
            return jsonify({'error': 'Unauthorized'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Error handlers
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad Request'}), 400

@app.errorhandler(401)
def unauthorized(e):
    return jsonify({'error': 'Unauthorized'}), 401

@app.errorhandler(500)
def internal_error(e):
    app.logger.error(f'Internal error: {str(e)}')
    return jsonify({'error': 'Internal Server Error'}), 500

# Register merchant endpoint
@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        
        if not data or not all(key in data for key in ['email', 'name', 'password']):
            return jsonify({'error': 'Missing required fields'}), 400
        
        email = data['email']
        name = data['name']
        password = data['password']
        
        # Basic email validation
        if '@' not in email:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Hash password
        password_hash = bcrypt.hash(password)
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                (email, name, password_hash)
            )
            conn.commit()
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Email already registered'}), 400
        finally:
            conn.close()
        
        return '', 201
        
    except Exception as e:
        app.logger.error(f'Registration error: {str(e)}')
        return jsonify({'error': 'Registration failed'}), 500

# Login endpoint
@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Missing email or password'}), 400
        
        email = data['email']
        password = data['password']
        
        # Check rate limit
        if not check_rate_limit(email):
            return jsonify({'error': 'Too many failed login attempts'}), 429
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT id, password_hash FROM merchants WHERE email = ?',
            (email,)
        )
        result = cursor.fetchone()
        conn.close()
        
        if not result or not bcrypt.verify(password, result[1]):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        merchant_id = result[0]
        
        # Clear rate limit on successful login
        if email in login_attempts:
            del login_attempts[email]
        
        # Create secure cookie
        auth_token = serializer.dumps(merchant_id)
        response = make_response(json.dumps('Login successful'), 200)
        response.set_cookie(
            'AUTH_COOKIE',
            auth_token,
            httponly=True,
            secure=True,
            samesite='Strict'
        )
        response.headers['Content-Type'] = 'application/json'
        
        return response
        
    except Exception as e:
        app.logger.error(f'Login error: {str(e)}')
        return jsonify({'error': 'Login failed'}), 500

# Upload wares endpoint
@app.route('/merchants/upload-wares', methods=['POST'])
@requires_auth
def upload_wares():
    try:
        data = request.get_json()
        
        if not data or 'csv' not in data:
            return jsonify({'error': 'Missing CSV data'}), 400
        
        csv_string = data['csv']
        merchant_id = request.merchant_id
        
        # Parse CSV
        csv_reader = csv.reader(io.StringIO(csv_string))
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Delete existing wares for this merchant
        cursor.execute('DELETE FROM wares WHERE merchant_id = ?', (merchant_id,))
        
        row_count = 0
        for row in csv_reader:
            if len(row) != 3:
                conn.rollback()
                conn.close()
                return jsonify({'error': 'Invalid CSV format - expected 3 columns'}), 400
            
            name, description, price_str = row
            
            try:
                price = float(price_str)
            except ValueError:
                conn.rollback()
                conn.close()
                return jsonify({'error': 'Invalid price format'}), 400
            
            cursor.execute(
                'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                (merchant_id, name, description, price)
            )
            row_count += 1
        
        if row_count == 0:
            conn.rollback()
            conn.close()
            return jsonify({'error': 'No wares to upload'}), 400
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Wares uploaded successfully'}), 200
        
    except Exception as e:
        app.logger.error(f'Upload wares error: {str(e)}')
        return jsonify({'error': 'Upload failed'}), 500

# Get wares endpoint
@app.route('/wares', methods=['GET'])
@requires_auth
def get_wares():
    try:
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
        results = cursor.fetchall()
        conn.close()
        
        # Create HTML table with proper escaping
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
                <tr>
                    <th>Name</th>
                    <th>Price</th>
                    <th>Description</th>
                    <th>Merchant Email</th>
                </tr>
                {% for ware in wares %}
                <tr>
                    <td>{{ ware[0]|e }}</td>
                    <td>{{ "%.2f"|format(ware[1]) }}</td>
                    <td>{{ ware[2]|e }}</td>
                    <td>{{ ware[3]|e }}</td>
                </tr>
                {% endfor %}
            </table>
        </body>
        </html>
        '''
        
        response = make_response(render_template_string(html_template, wares=results))
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        
        return response
        
    except Exception as e:
        app.logger.error(f'Get wares error: {str(e)}')
        return jsonify({'error': 'Failed to retrieve wares'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)