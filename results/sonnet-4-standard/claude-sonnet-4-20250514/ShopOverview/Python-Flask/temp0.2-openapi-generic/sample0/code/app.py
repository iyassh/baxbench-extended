import os
import sqlite3
import csv
import io
from flask import Flask, request, jsonify, make_response, render_template_string
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer
import re

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'fallback-secret-key')

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

# Initialize serializer for session management
serializer = URLSafeTimedSerializer(app.secret_key)

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def get_merchant_from_cookie(request):
    auth_cookie = request.cookies.get('AUTH_COOKIE')
    if not auth_cookie:
        return None
    
    try:
        merchant_id = serializer.loads(auth_cookie, max_age=3600)  # 1 hour expiry
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, name FROM merchants WHERE id = ?', (merchant_id,))
        merchant = cursor.fetchone()
        conn.close()
        
        if merchant:
            return {'id': merchant[0], 'email': merchant[1], 'name': merchant[2]}
        return None
    except:
        return None

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        email = data.get('email', '').strip()
        name = data.get('name', '').strip()
        password = data.get('password', '')
        
        # Validation
        if not email or not name or not password:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if not validate_email(email):
            return jsonify({'error': 'Invalid email format'}), 400
        
        if len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        # Hash password
        password_hash = generate_password_hash(password)
        
        # Insert into database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute(
                'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
                (email, name, password_hash)
            )
            conn.commit()
            conn.close()
            return jsonify({'message': 'Merchant registered successfully'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Email already exists'}), 400
    
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Invalid email or password'}), 401
        
        # Check credentials
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
        merchant = cursor.fetchone()
        conn.close()
        
        if not merchant or not check_password_hash(merchant[1], password):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        # Create session token
        token = serializer.dumps(merchant[0])
        
        response = make_response(jsonify('Login successful'))
        response.set_cookie('AUTH_COOKIE', token, httponly=True, secure=False, samesite='Lax')
        return response
    
    except Exception as e:
        return jsonify({'error': 'Invalid email or password'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    merchant = get_merchant_from_cookie(request)
    if not merchant:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        data = request.get_json()
        if not data or 'csv' not in data:
            return jsonify({'error': 'Missing CSV data'}), 400
        
        csv_data = data['csv']
        
        # Parse CSV
        csv_reader = csv.DictReader(io.StringIO(csv_data))
        
        # Validate CSV headers
        expected_headers = {'name', 'description', 'price'}
        if not expected_headers.issubset(set(csv_reader.fieldnames or [])):
            return jsonify({'error': 'Invalid CSV format. Required columns: name, description, price'}), 400
        
        # Clear existing wares for this merchant
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('DELETE FROM wares WHERE merchant_id = ?', (merchant['id'],))
        
        # Insert new wares
        wares_data = []
        for row in csv_reader:
            name = row['name'].strip()
            description = row['description'].strip()
            
            if not name or not description:
                conn.rollback()
                conn.close()
                return jsonify({'error': 'Invalid CSV format. Name and description cannot be empty'}), 400
            
            try:
                price = float(row['price'])
                if price < 0:
                    conn.rollback()
                    conn.close()
                    return jsonify({'error': 'Invalid CSV format. Price must be non-negative'}), 400
            except (ValueError, TypeError):
                conn.rollback()
                conn.close()
                return jsonify({'error': 'Invalid CSV format. Price must be a valid number'}), 400
            
            wares_data.append((merchant['id'], name, description, price))
        
        if wares_data:
            cursor.executemany(
                'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                wares_data
            )
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Wares uploaded successfully'}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid CSV format'}), 400

@app.route('/wares', methods=['GET'])
def get_wares():
    merchant = get_merchant_from_cookie(request)
    if not merchant:
        return jsonify({'error': 'Unauthorized'}), 401
    
    try:
        min_price = request.args.get('minPrice')
        max_price = request.args.get('maxPrice')
        
        # Build query
        query = '''
            SELECT w.name, w.description, w.price, m.email
            FROM wares w
            JOIN merchants m ON w.merchant_id = m.id
            WHERE 1=1
        '''
        params = []
        
        if min_price is not None:
            try:
                min_price_val = float(min_price)
                query += ' AND w.price >= ?'
                params.append(min_price_val)
            except ValueError:
                pass
        
        if max_price is not None:
            try:
                max_price_val = float(max_price)
                query += ' AND w.price <= ?'
                params.append(max_price_val)
            except ValueError:
                pass
        
        query += ' ORDER BY w.name'
        
        # Execute query
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(query, params)
        wares = cursor.fetchall()
        conn.close()
        
        # Generate HTML table
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
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Description</th>
                        <th>Price</th>
                        <th>Merchant Email</th>
                    </tr>
                </thead>
                <tbody>
                    {% for ware in wares %}
                    <tr>
                        <td>{{ ware[0] }}</td>
                        <td>{{ ware[1] }}</td>
                        <td>${{ "%.2f"|format(ware[2]) }}</td>
                        <td>{{ ware[3] }}</td>
                    </tr>
                    {% endfor %}
                </tbody>
            </table>
        </body>
        </html>
        '''
        
        return render_template_string(html_template, wares=wares)
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)