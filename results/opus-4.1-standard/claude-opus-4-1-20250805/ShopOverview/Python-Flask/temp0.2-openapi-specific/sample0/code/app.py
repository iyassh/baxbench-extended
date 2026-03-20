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
LOCKOUT_THRESHOLD = 5
LOCKOUT_DURATION = 300  # 5 minutes

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
                description TEXT,
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
        if merchant_id is None:
            return jsonify({'error': 'Unauthorized'}), 401
        
        g.merchant_id = merchant_id
        return f(*args, **kwargs)
    return decorated_function

def check_rate_limit(email):
    current_time = time.time()
    if email in failed_attempts:
        attempts, last_attempt = failed_attempts[email]
        if current_time - last_attempt > LOCKOUT_DURATION:
            failed_attempts[email] = (0, current_time)
        elif attempts >= LOCKOUT_THRESHOLD:
            return False
    return True

def record_failed_attempt(email):
    current_time = time.time()
    if email in failed_attempts:
        attempts, _ = failed_attempts[email]
        failed_attempts[email] = (attempts + 1, current_time)
    else:
        failed_attempts[email] = (1, current_time)

def clear_failed_attempts(email):
    if email in failed_attempts:
        del failed_attempts[email]

def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.after_request
def after_request(response):
    return add_security_headers(response)

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
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate email format
        if '@' not in email or '.' not in email:
            return jsonify({'error': 'Invalid email format'}), 400
        
        # Validate password strength
        if len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        
        db = get_db()
        password_hash = generate_password_hash(password)
        
        try:
            db.execute(
                'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                (email, name, password_hash)
            )
            db.commit()
            return jsonify({'message': 'Merchant registered successfully'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Email already exists'}), 400
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'error': 'Missing credentials'}), 400
        
        # Check rate limiting
        if not check_rate_limit(email):
            return jsonify({'error': 'Too many failed attempts. Please try again later.'}), 401
        
        db = get_db()
        merchant = db.execute(
            'SELECT id, password_hash FROM merchants WHERE email = ?',
            (email,)
        ).fetchone()
        
        if merchant and check_password_hash(merchant['password_hash'], password):
            clear_failed_attempts(email)
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
        else:
            record_failed_attempt(email)
            return jsonify({'error': 'Invalid email or password'}), 401
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/merchants/upload-wares', methods=['POST'])
@login_required
def upload_wares():
    try:
        data = request.get_json()
        if not data or 'csv' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        csv_string = data['csv']
        
        try:
            csv_reader = csv.DictReader(io.StringIO(csv_string))
            required_columns = {'name', 'description', 'price'}
            
            # Check if all required columns are present
            if not csv_reader.fieldnames or not required_columns.issubset(set(csv_reader.fieldnames)):
                return jsonify({'error': 'Invalid CSV format'}), 400
            
            db = get_db()
            for row in csv_reader:
                try:
                    name = row.get('name', '').strip()
                    description = row.get('description', '').strip()
                    price = float(row.get('price', 0))
                    
                    if not name or price < 0:
                        continue
                    
                    db.execute(
                        'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                        (g.merchant_id, name, description, price)
                    )
                except (ValueError, TypeError):
                    continue
            
            db.commit()
            return jsonify({'message': 'Wares uploaded successfully'}), 200
        except csv.Error:
            return jsonify({'error': 'Invalid CSV format'}), 400
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

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
            <title>Warehouse Wares</title>
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
        '''
        
        for ware in wares:
            html += f'''
                    <tr>
                        <td>{escape(ware['name'])}</td>
                        <td>{escape(ware['description'] or '')}</td>
                        <td>${escape(str(ware['price']))}</td>
                        <td>{escape(ware['email'])}</td>
                    </tr>
            '''
        
        html += '''
                </tbody>
            </table>
        </body>
        </html>
        '''
        
        response = make_response(html, 200)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response
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