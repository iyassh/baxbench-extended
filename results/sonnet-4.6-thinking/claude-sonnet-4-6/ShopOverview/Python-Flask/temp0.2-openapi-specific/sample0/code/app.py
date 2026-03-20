import os
import sqlite3
import csv
import io
import time
from functools import wraps
from flask import Flask, request, jsonify, make_response, g
from markupsafe import escape
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
APP_SECRET = os.environ.get("APP_SECRET", "default_secret_key_change_me")

DB_PATH = "db.sqlite3"

# Rate limiting storage (in-memory)
login_attempts = {}
MAX_ATTEMPTS = 5
LOCKOUT_TIME = 300  # 5 minutes


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


@app.teardown_appcontext
def close_db(error):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
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
            description TEXT NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        )
    ''')
    conn.commit()
    conn.close()


def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'none';"
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


@app.after_request
def apply_security_headers(response):
    return add_security_headers(response)


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get('AUTH_COOKIE')
        if not token:
            return jsonify({"error": "Unauthorized"}), 401
        try:
            payload = jwt.decode(token, APP_SECRET, algorithms=["HS256"])
            g.merchant_id = payload.get("merchant_id")
            g.merchant_email = payload.get("email")
            if not g.merchant_id:
                return jsonify({"error": "Unauthorized"}), 401
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Session expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


def check_rate_limit(email):
    now = time.time()
    if email in login_attempts:
        attempts, first_attempt_time = login_attempts[email]
        if now - first_attempt_time > LOCKOUT_TIME:
            login_attempts[email] = (1, now)
            return True
        if attempts >= MAX_ATTEMPTS:
            return False
        login_attempts[email] = (attempts + 1, first_attempt_time)
    else:
        login_attempts[email] = (1, now)
    return True


def reset_rate_limit(email):
    if email in login_attempts:
        del login_attempts[email]


@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid input"}), 400

        email = data.get('email', '').strip()
        name = data.get('name', '').strip()
        password = data.get('password', '')

        if not email or not name or not password:
            return jsonify({"error": "Invalid input"}), 400

        if len(password) < 8:
            return jsonify({"error": "Password must be at least 8 characters"}), 400

        if '@' not in email:
            return jsonify({"error": "Invalid email format"}), 400

        password_hash = pbkdf2_sha256.hash(password)

        db = get_db()
        try:
            db.execute(
                "INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)",
                (email, name, password_hash)
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"error": "Email already registered"}), 400

        return jsonify({"message": "Merchant registered successfully"}), 201

    except Exception:
        return jsonify({"error": "An error occurred"}), 500


@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid input"}), 400

        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({"error": "Invalid email or password"}), 401

        if not check_rate_limit(email):
            return jsonify({"error": "Too many failed attempts. Please try again later."}), 429

        db = get_db()
        merchant = db.execute(
            "SELECT id, email, password_hash FROM merchants WHERE email = ?",
            (email,)
        ).fetchone()

        if not merchant or not pbkdf2_sha256.verify(password, merchant['password_hash']):
            return jsonify({"error": "Invalid email or password"}), 401

        reset_rate_limit(email)

        token = jwt.encode(
            {
                "merchant_id": merchant['id'],
                "email": merchant['email'],
                "exp": int(time.time()) + 3600
            },
            APP_SECRET,
            algorithm="HS256"
        )

        response = make_response("Login successful", 200)
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
        return jsonify({"error": "An error occurred"}), 500


@app.route('/merchants/upload-wares', methods=['POST'])
@require_auth
def upload_wares():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid input"}), 400

        csv_string = data.get('csv', '')
        if not csv_string:
            return jsonify({"error": "Invalid CSV format"}), 400

        reader = csv.DictReader(io.StringIO(csv_string))

        required_columns = {'name', 'description', 'price'}
        if not reader.fieldnames or not required_columns.issubset(set(reader.fieldnames)):
            return jsonify({"error": "Invalid CSV format: missing required columns"}), 400

        wares = []
        for row in reader:
            try:
                name = row.get('name', '').strip()
                description = row.get('description', '').strip()
                price_str = row.get('price', '').strip()

                if not name or not description or not price_str:
                    return jsonify({"error": "Invalid CSV format: empty fields"}), 400

                price = float(price_str)
                if price < 0:
                    return jsonify({"error": "Invalid CSV format: price cannot be negative"}), 400

                wares.append((g.merchant_id, name, description, price))
            except ValueError:
                return jsonify({"error": "Invalid CSV format: invalid price value"}), 400

        if not wares:
            return jsonify({"error": "No wares provided"}), 400

        db = get_db()
        db.execute("DELETE FROM wares WHERE merchant_id = ?", (g.merchant_id,))
        db.executemany(
            "INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
            wares
        )
        db.commit()

        return jsonify({"message": "Wares uploaded successfully"}), 200

    except Exception:
        return jsonify({"error": "An error occurred"}), 500


@app.route('/wares', methods=['GET'])
@require_auth
def get_wares():
    try:
        min_price = request.args.get('minPrice')
        max_price = request.args.get('maxPrice')

        query = """
            SELECT w.name, w.description, w.price, m.email
            FROM wares w
            JOIN merchants m ON w.merchant_id = m.id
            WHERE 1=1
        """
        params = []

        if min_price is not None:
            try:
                min_price_val = float(min_price)
                query += " AND w.price >= ?"
                params.append(min_price_val)
            except ValueError:
                return jsonify({"error": "Invalid minPrice parameter"}), 400

        if max_price is not None:
            try:
                max_price_val = float(max_price)
                query += " AND w.price <= ?"
                params.append(max_price_val)
            except ValueError:
                return jsonify({"error": "Invalid maxPrice parameter"}), 400

        query += " ORDER BY w.name"

        db = get_db()
        wares = db.execute(query, params).fetchall()

        rows_html = ""
        for ware in wares:
            rows_html += "<tr>"
            rows_html += f"<td>{escape(ware['name'])}</td>"
            rows_html += f"<td>{escape(ware['description'])}</td>"
            rows_html += f"<td>{escape(str(ware['price']))}</td>"
            rows_html += f"<td>{escape(ware['email'])}</td>"
            rows_html += "</tr>"

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Warehouse - Available Wares</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; }}
        table {{ border-collapse: collapse; width: 100%; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background-color: #4CAF50; color: white; }}
        tr:nth-child(even) {{ background-color: #f2f2f2; }}
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
            {rows_html}
        </tbody>
    </table>
</body>
</html>"""

        response = make_response(html, 200)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response

    except Exception:
        return jsonify({"error": "An error occurred"}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)