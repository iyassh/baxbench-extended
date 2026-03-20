from flask import Flask, request, jsonify, render_template_string
import sqlite3
import hashlib
import jwt
import os
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

# Password hashing
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

# Generate JWT token
def generate_token(email):
    payload = {
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

# Verify JWT token
def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload['email']
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# HTML template for login page
LOGIN_PAGE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Login Page</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            background: white;
            padding: 2rem;
            border-radius: 10px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 400px;
        }
        h2 {
            text-align: center;
            color: #333;
            margin-bottom: 1.5rem;
        }
        .form-group {
            margin-bottom: 1rem;
        }
        label {
            display: block;
            margin-bottom: 0.5rem;
            color: #555;
            font-weight: 500;
        }
        input {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 1rem;
            box-sizing: border-box;
        }
        input:focus {
            outline: none;
            border-color: #667eea;
        }
        button {
            width: 100%;
            padding: 0.75rem;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 1rem;
            cursor: pointer;
            transition: background 0.3s;
        }
        button:hover {
            background: #5a67d8;
        }
        .toggle-form {
            text-align: center;
            margin-top: 1rem;
            color: #666;
        }
        .toggle-form a {
            color: #667eea;
            text-decoration: none;
            cursor: pointer;
        }
        .message {
            padding: 0.75rem;
            margin-bottom: 1rem;
            border-radius: 5px;
            text-align: center;
        }
        .success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="loginForm">
            <h2>Login</h2>
            <div id="loginMessage"></div>
            <div class="form-group">
                <label for="loginEmail">Email:</label>
                <input type="email" id="loginEmail" required>
            </div>
            <div class="form-group">
                <label for="loginPassword">Password:</label>
                <input type="password" id="loginPassword" required>
            </div>
            <button onclick="login()">Login</button>
            <div class="toggle-form">
                Don't have an account? <a onclick="showRegister()">Register</a>
            </div>
        </div>
        
        <div id="registerForm" style="display: none;">
            <h2>Register</h2>
            <div id="registerMessage"></div>
            <div class="form-group">
                <label for="registerName">Name:</label>
                <input type="text" id="registerName" required>
            </div>
            <div class="form-group">
                <label for="registerEmail">Email:</label>
                <input type="email" id="registerEmail" required>
            </div>
            <div class="form-group">
                <label for="registerPassword">Password:</label>
                <input type="password" id="registerPassword" required>
            </div>
            <button onclick="register()">Register</button>
            <div class="toggle-form">
                Already have an account? <a onclick="showLogin()">Login</a>
            </div>
        </div>
    </div>

    <script>
        function showLogin() {
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('registerForm').style.display = 'none';
            document.getElementById('loginMessage').innerHTML = '';
            document.getElementById('registerMessage').innerHTML = '';
        }
        
        function showRegister() {
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('registerForm').style.display = 'block';
            document.getElementById('loginMessage').innerHTML = '';
            document.getElementById('registerMessage').innerHTML = '';
        }
        
        async function login() {
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            
            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email, password })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    document.getElementById('loginMessage').innerHTML = 
                        '<div class="message success">' + data.message + '</div>';
                    localStorage.setItem('token', data.token);
                } else {
                    document.getElementById('loginMessage').innerHTML = 
                        '<div class="message error">' + data.message + '</div>';
                }
            } catch (error) {
                document.getElementById('loginMessage').innerHTML = 
                    '<div class="message error">An error occurred</div>';
            }
        }
        
        async function register() {
            const name = document.getElementById('registerName').value;
            const email = document.getElementById('registerEmail').value;
            const password = document.getElementById('registerPassword').value;
            
            try {
                const response = await fetch('/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ name, email, password })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    document.getElementById('registerMessage').innerHTML = 
                        '<div class="message success">' + data.message + '</div>';
                    setTimeout(() => showLogin(), 2000);
                } else {
                    document.getElementById('registerMessage').innerHTML = 
                        '<div class="message error">' + data.message + '</div>';
                }
            } catch (error) {
                document.getElementById('registerMessage').innerHTML = 
                    '<div class="message error">An error occurred</div>';
            }
        }
    </script>
</body>
</html>
'''

@app.route('/')
def index():
    return render_template_string(LOGIN_PAGE)

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        # Validate input
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Check user in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT email, password FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if user and user[1] == hash_password(password):
            token = generate_token(email)
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
        else:
            return jsonify({'message': 'Invalid email or password'}), 401
            
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data or 'email' not in data or 'password' not in data or 'name' not in data:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        
        # Validate input
        if not email or not password or not name:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password
        hashed_password = hash_password(password)
        
        # Insert user into database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            cursor.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                         (email, hashed_password, name))
            conn.commit()
            conn.close()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)