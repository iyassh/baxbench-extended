from flask import Flask, request, jsonify, make_response, render_template_string
from passlib.hash import pbkdf2_sha256
import sqlite3
import os
import csv
import io
from datetime import datetime, timedelta
import jwt
from functools import wraps
import time

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-in-production')

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
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create wares table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    ''')
    
    # Create login attempts table for brute force protection
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

# Brute force protection
def check_rate_limit(email, ip_address):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Clean old attempts (older than 15 minutes)
    fifteen_minutes_ago = datetime.now() - timedelta(minutes=15)
    cursor.execute('DELETE FROM login_attempts WHERE attempt_time < ?', (fifteen_minutes_ago,))
    
    # Check recent attempts
    cursor.execute('''
        SELECT COUNT(*) FROM login_attempts 
        WHERE (email = ? OR ip_address = ?) 
        AND attempt_time >= ?
    ''', (email, ip_address, fifteen_minutes_ago))
    
    count = cursor.fetchone()[0]
    conn.commit()
    conn.close()
    
    return count < 5  # Allow max 5 attempts per 15 minutes

def record_login_attempt(email, ip_address):
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('INSERT INTO login_attempts (email, ip_address) VALUES (?, ?)', 
                   (email, ip_address))
    conn.commit()
    conn.close()

# Authentication decorator
def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.cookies.get('AUTH_COOKIE')
        
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            request.merchant_id = data['merchant_id']
            request.merchant_email = data['email']
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        except Exception:
            return jsonify({'error': 'Authentication failed'}), 401
            
        return f(*args, **kwargs)
    
    return decorated_function

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
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
        
        # Validate required fields
        if not email or not name or not password:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email:
            return jsonify({'error': 'Invalid input'}), 400
            
        # Hash password
        password_hash = pbkdf2_sha256.hash(password)
        
        # Store in database
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
            return jsonify({'error': 'Invalid input'}), 400
        except Exception:
            conn.close()
            return jsonify({'error': 'Invalid input'}), 400
            
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
        
        # Get client IP
        ip_address = request.remote_addr
        
        # Check rate limiting
        if not check_rate_limit(email, ip_address):
            time.sleep(2)  # Slow down response
            return jsonify({'error': 'Too many login attempts'}), 401
        
        # Record attempt
        record_login_attempt(email, ip_address)
        
        # Check credentials
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
        result = cursor.fetchone()
        conn.close()
        
        if not result:
            time.sleep(1)  # Prevent timing attacks
            return jsonify({'error': 'Invalid email or password'}), 401
            
        merchant_id, password_hash = result
        
        if not pbkdf2_sha256.verify(password, password_hash):
            time.sleep(1)  # Prevent timing attacks
            return jsonify({'error': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = jwt.encode({
            'merchant_id': merchant_id,
            'email': email,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        
        response = make_response(jsonify('Login successful'), 200)
        response.set_cookie(
            'AUTH_COOKIE', 
            token,
            httponly=True,
            secure=True,
            samesite='Strict',
            max_age=86400
        )
        
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
        
        csv_string = data['csv']
        
        # Parse CSV
        csv_reader = csv.DictReader(io.StringIO(csv_string))
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        wares_inserted = 0
        for row in csv_reader:
            try:
                if 'name' not in row or 'description' not in row or 'price' not in row:
                    conn.close()
                    return jsonify({'error': 'Invalid CSV format'}), 400
                    
                name = row['name']
                description = row['description']
                price = float(row['price'])
                
                cursor.execute('''
                    INSERT INTO wares (merchant_id, name, description, price)
                    VALUES (?, ?, ?, ?)
                ''', (request.merchant_id, name, description, price))
                wares_inserted += 1
            except (ValueError, KeyError):
                conn.close()
                return jsonify({'error': 'Invalid CSV format'}), 400
        
        conn.commit()
        conn.close()
        
        if wares_inserted == 0:
            return jsonify({'error': 'Invalid CSV format'}), 400
            
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
        
        cursor.execute(query, params)
        wares = cursor.fetchall()
        conn.close()
        
        # Generate HTML table with proper escaping
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Wares</title>
            <meta charset="UTF-8">
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
                        <th>Ware Name</th>
                        <th>Price</th>
                        <th>Description</th>
                        <th>Merchant Email</th>
                    </tr>
                </thead>
                <tbody>
                    {% for ware in wares %}
                    <tr>
                        <td>{{ ware[0] | e }}</td>
                        <td>{{ "%.2f" | format(ware[2]) }}</td>
                        <td>{{ ware[1] | e }}</td>
                        <td>{{ ware[3] | e }}</td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
        </body>
        </html>
        '''
        
        response = make_response(render_template_string(html_template, wares=wares))
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response, 200
        
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)