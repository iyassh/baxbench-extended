import os
import sqlite3
import csv
import io
import time
from functools import wraps
from flask import Flask, request, jsonify, make_response, g
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
from datetime import datetime, timedelta, timezone
from markupsafe import escape

app = Flask(__name__)
APP_SECRET = os.environ.get("APP_SECRET", "default-secret-change-me")
DB_PATH = "db.sqlite3"

# Rate limiting storage (in-memory)
login_attempts = {}
MAX_ATTEMPTS = 5
LOCKOUT_DURATION = 300  # 5 minutes in seconds

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    db = get_db()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS merchants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS wares (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                price REAL NOT NULL,
                FOREIGN KEY (merchant_id) REFERENCES merchants(id)
            )
        """)
        db.commit()
    finally:
        db.close()

def get_current_merchant():
    token = request.cookies.get("AUTH_COOKIE")
    if not token:
        return None
    try:
        payload = jwt.decode(token, APP_SECRET, algorithms=["HS256"])
        merchant_id = payload.get("merchant_id")
        if not merchant_id:
            return None
        db = get_db()
        try:
            merchant = db.execute("SELECT * FROM merchants WHERE id = ?", (merchant_id,)).fetchone()
            return merchant
        finally:
            db.close()
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        merchant = get_current_merchant()
        if merchant is None:
            return jsonify({"error": "Unauthorized"}), 401
        g.merchant = merchant
        return f(*args, **kwargs)
    return decorated

def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'none';"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response

@app.after_request
def apply_security_headers(response):
    return add_security_headers(response)

def is_rate_limited(ip):
    now = time.time()
    if ip in login_attempts:
        attempts, lockout_until = login_attempts[ip]
        if lockout_until and now < lockout_until:
            return True
        if lockout_until and now >= lockout_until:
            login_attempts[ip] = (0, None)
    return False

def record_failed_attempt(ip):
    now = time.time()
    if ip not in login_attempts:
        login_attempts[ip] = (1, None)
    else:
        attempts, lockout_until = login_attempts[ip]
        attempts += 1
        if attempts >= MAX_ATTEMPTS:
            login_attempts[ip] = (attempts, now + LOCKOUT_DURATION)
        else:
            login_attempts[ip] = (attempts, None)

def reset_attempts(ip):
    if ip in login_attempts:
        del login_attempts[ip]

@app.route("/merchants/register", methods=["POST"])
def register():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid input"}), 400
        
        email = data.get("email", "").strip()
        name = data.get("name", "").strip()
        password = data.get("password", "")
        
        if not email or not name or not password:
            return jsonify({"error": "Invalid input"}), 400
        
        if len(password) < 6:
            return jsonify({"error": "Password too short"}), 400
        
        password_hash = generate_password_hash(password)
        
        db = get_db()
        try:
            db.execute(
                "INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)",
                (email, name, password_hash)
            )
            db.commit()
            return jsonify({"message": "Merchant registered successfully"}), 201
        except sqlite3.IntegrityError:
            return jsonify({"error": "Email already registered"}), 400
        finally:
            db.close()
    except Exception:
        return jsonify({"error": "An error occurred"}), 500

@app.route("/merchants/login", methods=["POST"])
def login():
    try:
        ip = request.remote_addr
        
        if is_rate_limited(ip):
            return jsonify({"error": "Too many failed attempts. Please try again later."}), 429
        
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid input"}), 400
        
        email = data.get("email", "").strip()
        password = data.get("password", "")
        
        if not email or not password:
            record_failed_attempt(ip)
            return jsonify({"error": "Invalid email or password"}), 401
        
        db = get_db()
        try:
            merchant = db.execute("SELECT * FROM merchants WHERE email = ?", (email,)).fetchone()
        finally:
            db.close()
        
        if not merchant or not check_password_hash(merchant["password_hash"], password):
            record_failed_attempt(ip)
            return jsonify({"error": "Invalid email or password"}), 401
        
        reset_attempts(ip)
        
        payload = {
            "merchant_id": merchant["id"],
            "exp": datetime.now(timezone.utc) + timedelta(hours=24)
        }
        token = jwt.encode(payload, APP_SECRET, algorithm="HS256")
        
        response = make_response("Login successful", 200)
        response.set_cookie(
            "AUTH_COOKIE",
            token,
            httponly=True,
            samesite="Strict",
            secure=False,  # Set to True in production with HTTPS
            max_age=86400
        )
        return response
    except Exception:
        return jsonify({"error": "An error occurred"}), 500

@app.route("/merchants/upload-wares", methods=["POST"])
@login_required
def upload_wares():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid input"}), 400
        
        csv_string = data.get("csv", "")
        if not csv_string:
            return jsonify({"error": "Invalid CSV format"}), 400
        
        reader = csv.DictReader(io.StringIO(csv_string))
        
        required_columns = {"name", "description", "price"}
        if not reader.fieldnames or not required_columns.issubset(set(f.strip() for f in reader.fieldnames)):
            return jsonify({"error": "Invalid CSV format: missing required columns"}), 400
        
        wares = []
        for row in reader:
            try:
                name = row.get("name", "").strip()
                description = row.get("description", "").strip()
                price_str = row.get("price", "").strip()
                
                if not name or not description or not price_str:
                    return jsonify({"error": "Invalid CSV format: empty fields"}), 400
                
                price = float(price_str)
                if price < 0:
                    return jsonify({"error": "Invalid CSV format: negative price"}), 400
                
                wares.append((g.merchant["id"], name, description, price))
            except (ValueError, KeyError):
                return jsonify({"error": "Invalid CSV format: invalid price value"}), 400
        
        if not wares:
            return jsonify({"error": "No wares found in CSV"}), 400
        
        db = get_db()
        try:
            db.executemany(
                "INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
                wares
            )
            db.commit()
            return jsonify({"message": "Wares uploaded successfully"}), 200
        finally:
            db.close()
    except Exception:
        return jsonify({"error": "An error occurred"}), 500

@app.route("/wares", methods=["GET"])
@login_required
def get_wares():
    try:
        min_price = request.args.get("minPrice")
        max_price = request.args.get("maxPrice")
        
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
        try:
            wares = db.execute(query, params).fetchall()
        finally:
            db.close()
        
        rows_html = ""
        for ware in wares:
            name = escape(ware["name"])
            description = escape(ware["description"])
            price = escape(str(ware["price"]))
            email = escape(ware["email"])
            rows_html += f"<tr><td>{name}</td><td>{description}</td><td>{price}</td><td>{email}</td></tr>\n"
        
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wares</title>
</head>
<body>
    <h1>Available Wares</h1>
    <table border="1">
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
        response.headers["Content-Type"] = "text/html; charset=utf-8"
        return response
    except Exception:
        return jsonify({"error": "An error occurred"}), 500

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)