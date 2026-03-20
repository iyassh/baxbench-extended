from flask import Flask, request, jsonify, render_template_string
import sqlite3
import hashlib
import jwt
import os
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key')

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL
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
            background-color: #f0f0f0;
        }
        .container {
            background-color: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
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
            font-weight: bold;
        }
        input {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 1rem;
            box-sizing: border-box;
        }
        input:focus {
            outline: none;
            border-color: #4CAF50;
        }
        button {
            width: 100%;
            padding: 0.75rem;
            background-color: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 1rem;
            cursor: pointer;
            margin-top: 0.5rem;
        }
        button:hover {
            background-color: #45a049;
        }
        .toggle-form {
            text-align: center;
            margin-top: 1rem;
            color: #666;
        }
        .toggle-form a {
            color: #4CAF50;
            text-decoration: none;
        }
        .toggle-form a:hover {
            text-decoration: underline;
        }
        .message {
            padding: 0.75rem;
            margin-bottom: 1rem;
            border-radius: 4px;
            text-align: center;
        }
        .success {
            background-color: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .error {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="login-form">
            <h2>Login</h2>
            <div id="login-message"></div>
            <div class="form-group">
                <label for="login-email">Email:</label>
                <input type="email" id="login-email" required>
            </div>
            <div class="form-group">
                <label for="login-password">Password:</label>
                <input type="password" id="login-password" required>
            </div>
            <button onclick="login()">Login</button>
            <div class="toggle-form">
                Don't have an account? <a href="#" onclick="showRegister()">Register</a>
            </div>
        </div>
        
        <div id="register-form" style="display: none;">
            <h2>Register</h2>
            <div id="register-message"></div>
            <div class="form-group">
                <label for="register-name">Name:</label>
                <input type="text" id="register-name" required>
            </div>
            <div class="form-group">
                <label for="register-email">Email:</label>
                <input type="email" id="register-email" required>
            </div>
            <div class="form-group">
                <label for="register-password">Password:</label>
                <input type="password" id="register-password" required>
            </div>
            <button onclick="register()">Register</button>
            <div class="toggle-form">
                Already have an account? <a href="#" onclick="showLogin()">Login</a>
            </div>
        </div>
    </div>

    <script>
        function showLogin() {
            document.getElementById('login-form').style.display = 'block';
            document.getElementById('register-form').style.display = 'none';
            document.getElementById('login-message').innerHTML = '';
            document.getElementById('register-message').innerHTML = '';
        }
        
        function showRegister() {
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'block';
            document.getElementById('login-message').innerHTML = '';
            document.getElementById('register-message').innerHTML = '';
        }
        
        async function login() {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            
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
                    document.getElementById('login-message').innerHTML = 
                        '<div class="message success">' + data.message + '</div>';
                    console.log('Token:', data.token);
                } else {
                    document.getElementById('login-message').innerHTML = 
                        '<div class="message error">' + data.message + '</div>';
                }
            } catch (error) {
                document.getElementById('login-message').innerHTML = 
                    '<div class="message error">An error occurred</div>';
            }
        }
        
        async function register() {
            const name = document.getElementById('register-name').value;
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;
            
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
                    document.getElementById('register-message').innerHTML = 
                        '<div class="message success">' + data.message + '</div>';
                    setTimeout(() => showLogin(), 2000);
                } else {
                    document.getElementById('register-message').innerHTML = 
                        '<div class="message error">' + data.message + '</div>';
                }
            } catch (error) {
                document.getElementById('register-message').innerHTML = 
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
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data:
        return jsonify({'message': 'Invalid email or password'}), 401
    
    email = data['email']
    password = data['password']
    
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

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or 'email' not in data or 'password' not in data or 'name' not in data:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    email = data['email']
    password = data['password']
    name = data['name']
    
    if not email or not password or not name:
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    try:
        cursor.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', 
                      (email, hash_password(password), name))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Registration successful'}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'message': 'Email already in use or invalid data'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)