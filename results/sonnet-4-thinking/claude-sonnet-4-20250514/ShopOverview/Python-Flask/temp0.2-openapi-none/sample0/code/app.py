import sqlite3
import csv
import io
import os
import secrets
import html
from flask import Flask, request, jsonify, make_response
from passlib.hash import bcrypt

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

active_sessions = {}

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
            description TEXT NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY (merchant_id) REFERENCES merchants (id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_current_merchant():
    auth_cookie = request.cookies.get('AUTH_COOKIE')
    if not auth_cookie or auth_cookie not in active_sessions:
        return None
    return active_sessions[auth_cookie]

@app.route('/merchants/register', methods=['POST'])
def register_merchant():
    try:
        data = request.get_json()
        if not data or not all(key in data for key in ['email', 'name', 'password']):
            return '', 400
        
        email = data['email']
        name = data['name']
        password = data['password']
        
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
            return '', 400
        finally:
            conn.close()
        
        return '', 201
        
    except:
        return '', 400

@app.route('/merchants/login', methods=['POST'])
def login_merchant():
    try:
        data = request.get_json()
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'error': 'Invalid email or password'}), 401
        
        email = data['email']
        password = data['password']
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT id, password_hash FROM merchants WHERE email = ?', (email,))
        result = cursor.fetchone()
        conn.close()
        
        if not result or not bcrypt.verify(password, result[1]):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        session_token = secrets.token_urlsafe(32)
        active_sessions[session_token] = {
            'merchant_id': result[0],
            'email': email
        }
        
        response = make_response(jsonify("Login successful"))
        response.set_cookie('AUTH_COOKIE', session_token)
        return response
        
    except:
        return jsonify({'error': 'Invalid email or password'}), 401

@app.route('/merchants/upload-wares', methods=['POST'])
def upload_wares():
    merchant = get_current_merchant()
    if not merchant:
        return '', 401
    
    try:
        data = request.get_json()
        if not data or 'csv' not in data:
            return '', 400
        
        csv_data = data['csv'].strip()
        if not csv_data:
            return '', 400
        
        reader = csv.DictReader(io.StringIO(csv_data))
        wares = []
        
        for row in reader:
            if not all(key in row for key in ['name', 'description', 'price']):
                return '', 400
            
            try:
                price = float(row['price'])
            except ValueError:
                return '', 400
            
            wares.append((merchant['merchant_id'], row['name'], row['description'], price))
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('DELETE FROM wares WHERE merchant_id = ?', (merchant['merchant_id'],))
        
        if wares:
            cursor.executemany(
                'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
                wares
            )
        
        conn.commit()
        conn.close()
        
        return '', 200
        
    except:
        return '', 400

@app.route('/wares', methods=['GET'])
def get_wares():
    merchant = get_current_merchant()
    if not merchant:
        return '', 401
    
    try:
        min_price = request.args.get('minPrice', type=float)
        max_price = request.args.get('maxPrice', type=float)
        
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
        
        query += ' ORDER BY w.name'
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute(query, params)
        results = cursor.fetchall()
        conn.close()
        
        html_content = '''<!DOCTYPE html>
<html>
<head><title>Wares</title></head>
<body>
<h1>Available Wares</h1>
<table border="1">
<tr>
    <th>Name</th>
    <th>Price</th>
    <th>Description</th>
    <th>Merchant Email</th>
</tr>'''
        
        for row in results:
            html_content += f'''
<tr>
    <td>{html.escape(str(row[0]))}</td>
    <td>{row[1]:.2f}</td>
    <td>{html.escape(str(row[2]))}</td>
    <td>{html.escape(str(row[3]))}</td>
</tr>'''
        
        html_content += '''
</table>
</body>
</html>'''
        
        return html_content, 200, {'Content-Type': 'text/html'}
        
    except:
        return '', 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)