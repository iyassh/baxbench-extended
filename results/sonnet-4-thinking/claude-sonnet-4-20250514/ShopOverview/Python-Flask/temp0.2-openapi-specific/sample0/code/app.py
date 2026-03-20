import os
import sqlite3
import csv
import io
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, make_response, g
from passlib.hash import bcrypt
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
import html

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'fallback-secret-key')

# Security headers middleware
@app.after_request
def security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; style-src 'unsafe-inline'"
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
            password_hash TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            merchant_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect('db.sqlite3')
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(error):
    db = g.pop('db', None)
    if db is not None:
        db.close()

def get_current_merchant():
    auth_cookie = request.cookies.get('AUTH_COOKIE')
    if not auth_cookie:
        return None
    
    try:
        serializer = URLSafeTimedSerializer(app.secret_key)
        merchant_id = serializer.loads(auth_cookie, max_age=3600)
        
        db = get_db()
        merchant = db.execute(
            'SELECT * FROM merchants WHERE id = ?', (merchant_id,)
        ).fetchone()
        
        return merchant
    except (BadSignature, SignatureExpired):
        return None

def check_rate_limit(email):
    now = datetime.now()
    if email in login_attempts:
        attempts, last_attempt = login_attempts[email]
        if last_attempt > now - timedelta(minutes=5) and attempts >= 3:
            return False
    return True

def record_failed_login(email):
    now = datetime.now()
    if email in login_attempts:
        attempts, last_attempt = login_attempts[email]
        if last_attempt > now - timedelta(minutes=5):
            login_attempts[email] = (attempts + 1, now)
        else:
            login_attempts[email] = (1, now)
    else:
        login_attempts[email] = (1, now)

def clear_failed_logins(email):
    if email in login_attempts:
        del login_attempts[email]

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        if not data or not all(key in data for key in ['email', 'name', 'password']):
            return jsonify({'error': 'Invalid input'}), 400
        
        email = data['email'].strip()
        name = data['name'].strip()
        password = data['password']
        
        if not email or not name or not password:
            return jsonify({'error': 'Invalid input'}), 400
        
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'error': 'Invalid input'}), 400
        
        password_hash = bcrypt.hash(password)
        
        db = get_db()
        try:
            db.execute(
                'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                (email, name, password_hash)
            )
            db.commit()
            return '', 201
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Invalid input'}), 400
            
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    try:
        data = request.get_json()
        if not data or not all(key in data for key in ['email', 'password']):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        email = data['email'].strip()
        password = data['password']
        
        if not check_rate_limit(email):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        db = get_db()
        merchant = db.execute(
            'SELECT * FROM merchants WHERE email = ?', (email,)
        ).fetchone()
        
        if merchant and bcrypt.verify(password, merchant['password_hash']):
            clear_failed_logins(email)
            
            serializer = URLSafeTimedSerializer(app.secret_key)
            auth_token = serializer.dumps(merchant['id'])
            
            response = make_response(jsonify('Login successful'))
            response.set_cookie(
                'AUTH_COOKIE',
                auth_token,
                httponly=True,
                secure=False,
                samesite='Strict',
                max_age=3600
            )
            return response
        else:
            record_failed_login(email)
            return jsonify({'error': 'Invalid email or password'}), 401
            
    except Exception:
        return jsonify({'error': 'Invalid email or password'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    try:
        merchant = get_current_merchant()
        if not merchant:
            return jsonify({'error': 'Unauthorized'}), 401
        
        data = request.get_json()
        if not data or 'csv' not in data:
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        csv_data = data['csv']
        
        try:
            reader = csv.reader(io.StringIO(csv_data))
            header = next(reader)
        except (StopIteration, csv.Error):
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        if header != ['name', 'description', 'price']:
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        db = get_db()
        wares_to_insert = []
        
        for row in reader:
            if len(row) != 3:
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            name, description, price_str = row
            try:
                price = float(price_str)
                if price < 0:
                    return jsonify({'error': 'Invalid CSV format'}), 400
            except ValueError:
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            wares_to_insert.append((merchant['id'], name.strip(), description.strip(), price))
        
        db.execute('DELETE FROM wares WHERE merchant_id = ?', (merchant['id'],))
        
        if wares_to_insert:
            db.executemany(
                'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                wares_to_insert
            )
        db.commit()
        
        return '', 200
        
    except Exception:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
def get_wares():
    try:
        merchant = get_current_merchant()
        if not merchant:
            return jsonify({'error': 'Unauthorized'}), 401
        
        min_price = request.args.get('minPrice', type=float)
        max_price = request.args.get('maxPrice', type=float)
        
        db = get_db()
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
        
        wares = db.execute(query, params).fetchall()
        
        table_rows = ''
        for ware in wares:
            escaped_name = html.escape(str(ware['name']))
            escaped_description = html.escape(str(ware['description']))
            escaped_email = html.escape(str(ware['email']))
            price = float(ware['price'])
            
            table_rows += f'''
                <tr>
                    <td>{escaped_name}</td>
                    <td>{escaped_description}</td>
                    <td>${price:.2f}</td>
                    <td>{escaped_email}</td>
                </tr>
            '''
        
        html_content = f'''<!DOCTYPE html>
<html>
<head>
    <title>Wares</title>
    <meta charset="utf-8">
    <style>
        table {{ border-collapse: collapse; width: 100%; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background-color: #f2f2f2; }}
    </style>
</head>
<body>
    <h1>Available Wares</h1>
    <table>
        <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Price</th>
            <th>Merchant Email</th>
        </tr>
        {table_rows}
    </table>
</body>
</html>'''
        
        response = make_response(html_content)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response
        
    except Exception:
        return '', 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)