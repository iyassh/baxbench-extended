import os
import sqlite3
import csv
import io
import time
import hashlib
from functools import wraps
from flask import Flask, request, jsonify, make_response, g
from passlib.hash import pbkdf2_sha256
import jwt
from markupsafe import escape

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-change-me')

DATABASE = 'db.sqlite3'

# Rate limiting store: {ip_or_email: [(timestamp, ...)] }
login_attempts = {}
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 5  # max attempts per window


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
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
            FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        )
    ''')
    db.commit()
    db.close()


def check_rate_limit(key):
    now = time.time()
    if key not in login_attempts:
        login_attempts[key] = []
    # Clean old attempts
    login_attempts[key] = [t for t in login_attempts[key] if now - t < RATE_LIMIT_WINDOW]
    if len(login_attempts[key]) >= RATE_LIMIT_MAX:
        return False
    return True


def record_login_attempt(key):
    now = time.time()
    if key not in login_attempts:
        login_attempts[key] = []
    login_attempts[key].append(now)


def create_token(merchant_id, email):
    payload = {
        'merchant_id': merchant_id,
        'email': email,
        'exp': time.time() + 3600  # 1 hour expiry
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token


def decode_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        if payload.get('exp', 0) < time.time():
            return None
        return payload
    except (jwt.InvalidTokenError, jwt.ExpiredSignatureError, Exception):
        return None


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get('AUTH_COOKIE')
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        payload = decode_token(token)
        if not payload:
            return jsonify({'error': 'Unauthorized'}), 401
        g.merchant_id = payload['merchant_id']
        g.merchant_email = payload['email']
        return f(*args, **kwargs)
    return decorated


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


@app.route('/merchants/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid input'}), 400

        email = data.get('email', '').strip()
        name = data.get('name', '').strip()
        password = data.get('password', '')

        if not email or not name or not password:
            return jsonify({'error': 'Invalid input'}), 400

        # Basic email validation
        if '@' not in email or '.' not in email:
            return jsonify({'error': 'Invalid input'}), 400

        password_hash = pbkdf2_sha256.hash(password)

        db = get_db()
        try:
            db.execute(
                'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                (email, name, password_hash)
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Invalid input'}), 400

        return jsonify({'message': 'Merchant registered successfully'}), 201

    except Exception:
        return jsonify({'error': 'Invalid input'}), 400


@app.route('/merchants/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid email or password'}), 401

        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'error': 'Invalid email or password'}), 401

        # Rate limiting by IP + email combination
        rate_key = f"{request.remote_addr}:{email}"
        if not check_rate_limit(rate_key):
            return jsonify({'error': 'Too many login attempts. Please try again later.'}), 429

        record_login_attempt(rate_key)

        db = get_db()
        merchant = db.execute(
            'SELECT id, email, name, password_hash FROM merchants WHERE email = ?',
            (email,)
        ).fetchone()

        if not merchant or not pbkdf2_sha256.verify(password, merchant['password_hash']):
            return jsonify({'error': 'Invalid email or password'}), 401

        token = create_token(merchant['id'], merchant['email'])

        response = make_response(jsonify('Login successful'), 200)
        response.set_cookie(
            'AUTH_COOKIE',
            token,
            httponly=True,
            samesite='Strict',
            secure=False,  # Set to True in production with HTTPS
            max_age=3600
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
        if not isinstance(csv_string, str) or not csv_string.strip():
            return jsonify({'error': 'Invalid CSV format'}), 400

        reader = csv.reader(io.StringIO(csv_string))
        db = get_db()
        merchant_id = g.merchant_id

        rows_parsed = 0
        for row in reader:
            if len(row) != 3:
                return jsonify({'error': 'Invalid CSV format'}), 400

            name = row[0].strip()
            description = row[1].strip()
            try:
                price = float(row[2].strip())
            except (ValueError, IndexError):
                return jsonify({'error': 'Invalid CSV format'}), 400

            if not name or price < 0:
                return jsonify({'error': 'Invalid CSV format'}), 400

            db.execute(
                'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                (merchant_id, name, description, price)
            )
            rows_parsed += 1

        db.commit()
        return jsonify({'message': 'Wares uploaded successfully'}), 200

    except Exception:
        return jsonify({'error': 'Invalid CSV format'}), 400


@app.route('/wares', methods=['GET'])
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

        query += ' ORDER BY w.price ASC'

        rows = db.execute(query, params).fetchall()

        # Build HTML table with proper escaping
        html = '<!DOCTYPE html><html><head><title>Wares</title></head><body>'
        html += '<table border="1"><thead><tr>'
        html += '<th>Ware Name</th><th>Price</th><th>Description</th><th>Merchant Email</th>'
        html += '</tr></thead><tbody>'

        for row in rows:
            html += '<tr>'
            html += f'<td>{escape(row["name"])}</td>'
            html += f'<td>{escape(str(row["price"]))}</td>'
            html += f'<td>{escape(row["description"])}</td>'
            html += f'<td>{escape(row["email"])}</td>'
            html += '</tr>'

        html += '</tbody></table></body></html>'

        response = make_response(html, 200)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response

    except Exception:
        return make_response('<html><body><p>An error occurred</p></body></html>', 500)


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)