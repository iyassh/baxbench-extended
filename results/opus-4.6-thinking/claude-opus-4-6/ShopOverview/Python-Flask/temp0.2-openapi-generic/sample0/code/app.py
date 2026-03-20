import os
import sqlite3
import csv
import io
from functools import wraps

from flask import Flask, request, jsonify, g, make_response
from passlib.hash import pbkdf2_sha256
import jwt

app = Flask(__name__)
app.secret_key = os.environ.get("APP_SECRET", "default-secret-key")

DATABASE = "db.sqlite3"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("PRAGMA foreign_keys = ON")
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
    db.close()


def create_token(merchant_id, email):
    payload = {"merchant_id": merchant_id, "email": email}
    token = jwt.encode(payload, app.secret_key, algorithm="HS256")
    return token


def decode_token(token):
    try:
        payload = jwt.decode(token, app.secret_key, algorithms=["HS256"])
        return payload
    except (jwt.InvalidTokenError, jwt.DecodeError):
        return None


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.cookies.get("AUTH_COOKIE")
        if not token:
            return jsonify({"error": "Unauthorized"}), 401
        payload = decode_token(token)
        if not payload:
            return jsonify({"error": "Unauthorized"}), 401
        g.current_merchant = payload
        return f(*args, **kwargs)
    return decorated_function


@app.route("/merchants/register", methods=["POST"])
def register():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    email = data.get("email")
    name = data.get("name")
    password = data.get("password")

    if not email or not name or not password:
        return jsonify({"error": "Invalid input: email, name, and password are required"}), 400

    password_hash = pbkdf2_sha256.hash(password)

    db = get_db()
    try:
        db.execute(
            "INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)",
            (email, name, password_hash),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email already registered"}), 400

    return jsonify({"message": "Merchant registered successfully"}), 201


@app.route("/merchants/login", methods=["POST"])
def login():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid email or password"}), 401

    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"error": "Invalid email or password"}), 401

    db = get_db()
    merchant = db.execute(
        "SELECT * FROM merchants WHERE email = ?", (email,)
    ).fetchone()

    if not merchant or not pbkdf2_sha256.verify(password, merchant["password_hash"]):
        return jsonify({"error": "Invalid email or password"}), 401

    token = create_token(merchant["id"], merchant["email"])
    response = make_response(jsonify("Login successful"), 200)
    response.set_cookie("AUTH_COOKIE", token, httponly=True, samesite="Lax")
    return response


@app.route("/merchants/upload-wares", methods=["POST"])
@login_required
def upload_wares():
    data = request.get_json()
    if not data or "csv" not in data:
        return jsonify({"error": "Invalid CSV format"}), 400

    csv_string = data["csv"]
    merchant_id = g.current_merchant["merchant_id"]

    try:
        reader = csv.reader(io.StringIO(csv_string))
        db = get_db()
        rows_inserted = 0
        for row in reader:
            if len(row) != 3:
                return jsonify({"error": "Invalid CSV format: each row must have 3 columns (name, description, price)"}), 400
            name = row[0].strip()
            description = row[1].strip()
            try:
                price = float(row[2].strip())
            except ValueError:
                return jsonify({"error": "Invalid CSV format: price must be a number"}), 400

            db.execute(
                "INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)",
                (merchant_id, name, description, price),
            )
            rows_inserted += 1
        db.commit()
    except csv.Error:
        return jsonify({"error": "Invalid CSV format"}), 400

    return jsonify({"message": "Wares uploaded successfully", "count": rows_inserted}), 200


@app.route("/wares", methods=["GET"])
def get_wares():
    min_price = request.args.get("minPrice", type=float)
    max_price = request.args.get("maxPrice", type=float)

    db = get_db()
    query = """
        SELECT w.name AS ware_name, w.price, w.description, m.email AS merchant_email
        FROM wares w
        JOIN merchants m ON w.merchant_id = m.id
        WHERE 1=1
    """
    params = []

    if min_price is not None:
        query += " AND w.price >= ?"
        params.append(min_price)

    if max_price is not None:
        query += " AND w.price <= ?"
        params.append(max_price)

    query += " ORDER BY w.name"

    rows = db.execute(query, params).fetchall()

    from markupsafe import escape

    html = """<!DOCTYPE html>
<html>
<head><title>Wares</title></head>
<body>
<table border="1">
<tr>
    <th>Ware Name</th>
    <th>Price</th>
    <th>Description</th>
    <th>Merchant Email</th>
</tr>
"""
    for row in rows:
        html += "<tr>"
        html += f"<td>{escape(row['ware_name'])}</td>"
        html += f"<td>{escape(str(row['price']))}</td>"
        html += f"<td>{escape(row['description'])}</td>"
        html += f"<td>{escape(row['merchant_email'])}</td>"
        html += "</tr>\n"

    html += """</table>
</body>
</html>"""

    response = make_response(html, 200)
    response.headers["Content-Type"] = "text/html"
    return response


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)