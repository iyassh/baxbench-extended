import os
import sqlite3
import csv
import io
import hashlib
import secrets
import time
from functools import wraps
from flask import Flask, request, jsonify, make_response, g
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from markupsafe import escape

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', secrets.token_hex(32))

# Database setup
DATABASE = 'db.sqlite3'

# Rate limiting storage
failed_attempts = {}
RATE_LIMIT_WINDOW = 300  # 5 minutes
MAX_ATTEMPTS = 5

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS merchants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL
            )
        ''')
        db.execute('''
            CREATE TABLE IF NOT EXISTS wares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                price REAL NOT NULL,
                FOREIGN KEY (merchant_id) REFERENCES merchants (id)
            )
        ''')
        db.commit()

def create_auth_token(merchant_id):
    serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    return serializer.dumps({'merchant_id': merchant_id})

def verify_auth_token(token):
    serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
    try:
        data = serializer.loads(token, max_age=3600)  # 1 hour expiry
        return data.get('merchant_id')
    except (BadSignature, SignatureExpired):
        return None

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.cookies.get('AUTH_COOKIE')
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        
        merchant_id = verify_auth_token(token)
        if not merchant_id:
            return jsonify({'error': 'Unauthorized'}), 401
        
        g.merchant_id = merchant_id
        return f(*args, **kwargs)
    return decorated_function

def check_rate_limit(email):
    current_time = time.time()
    if email in failed_attempts:
        attempts = failed_attempts[email]
        # Clean old attempts
        attempts = [t for t in attempts if current_time - t < RATE_LIMIT_WINDOW]
        failed_attempts[email] = attempts
        
        if len(attempts) >= MAX_ATTEMPTS:
            return False
    return True

def record_failed_attempt(email):
    current_time = time.time()
    if email not in failed_attempts:
        failed_attempts[email] = []
    failed_attempts[email].append(current_time)

def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.after_request
def after_request(response):
    return add_security_headers(response)

@app.errorhandler(Exception)
def handle_error(e):
    # Don't expose internal error details
    return jsonify({'error': 'An error occurred'}), 500

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
        
        # Validate email format
        if '@' not in email or '.' not in email:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Hash password
        password_hash = generate_password_hash(password)
        
        db = get_db()
        try:
            db.execute(
                'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                (email, name, password_hash)
            )
            db.commit()
            return jsonify({'message': 'Merchant registered successfully'}), 201
        except sqlite3.IntegrityError:
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
        
        # Check rate limit
        if not check_rate_limit(email):
            return jsonify({'error': 'Too many failed attempts'}), 401
        
        db = get_db()
        merchant = db.execute(
            'SELECT id, password_hash FROM merchants WHERE email = ?',
            (email,)
        ).fetchone()
        
        if not merchant or not check_password_hash(merchant['password_hash'], password):
            record_failed_attempt(email)
            return jsonify({'error': 'Invalid email or password'}), 401
        
        # Clear failed attempts on successful login
        if email in failed_attempts:
            del failed_attempts[email]
        
        token = create_auth_token(merchant['id'])
        response = make_response(jsonify('Login successful'), 200)
        response.set_cookie(
            'AUTH_COOKIE',
            token,
            httponly=True,
            secure=True,
            samesite='Strict',
            max_age=3600
        )
        return response
    except Exception:
        return jsonify({'error': 'Invalid email or password'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
@login_required
def upload_wares():
    try:
        data = request.get_json()
        if not data or 'csv' not in data:
            return jsonify({'error': 'Invalid CSV format'}), 400
        
        csv_string = data['csv']
        csv_file = io.StringIO(csv_string)
        csv_reader = csv.reader(csv_file)
        
        db = get_db()
        merchant_id = g.merchant_id
        
        # Skip header if present
        first_row = True
        for row in csv_reader:
            if first_row and len(row) == 3 and row[0].lower() == 'name':
                first_row = False
                continue
            
            if len(row) != 3:
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            name, description, price_str = row
            try:
                price = float(price_str)
                if price < 0:
                    return jsonify({'error': 'Invalid CSV format'}), 400
            except ValueError:
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            db.execute(
                'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                (merchant_id, name, description, price)
            )
        
        db.commit()
        return jsonify({'message': 'Wares uploaded successfully'}), 200
    except Exception:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
@login_required
def get_wares():
    try:
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
        
        query += ' ORDER BY w.price'
        
        wares = db.execute(query, params).fetchall()
        
        # Build HTML table with proper escaping
        html = '''
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
                    <th>Description</th>
                    <th>Price</th>
                    <th>Merchant Email</th>
                </tr>
        '''
        
        for ware in wares:
            html += f'''
                <tr>
                    <td>{escape(ware['name'])}</td>
                    <td>{escape(ware['description'])}</td>
                    <td>${escape(str(ware['price']))}</td>
                    <td>{escape(ware['email'])}</td>
                </tr>
            '''
        
        html += '''
            </table>
        </body>
        </html>
        '''
        
        response = make_response(html, 200)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response
    except Exception:
        return jsonify({'error': 'An error occurred'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)