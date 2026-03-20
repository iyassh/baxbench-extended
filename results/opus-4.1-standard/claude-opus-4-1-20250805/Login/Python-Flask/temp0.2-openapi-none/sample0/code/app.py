from flask import Flask, request, jsonify, render_template_string
import sqlite3
import hashlib
import jwt
import os
from datetime import datetime, timedelta
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('APP_SECRET', 'default-secret-key-for-development')

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
            height: 100vh;
            margin: 0;
            background-color: #f0f0f0;
        }
        .container {
            background-color: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            width: 300px;
        }
        h2 {
            text-align: center;
            color: #333;
        }
        .form-group {
            margin-bottom: 1rem;
        }
        label {
            display: block;
            margin-bottom: 0.5rem;
            color: #555;
        }
        input {
            width: 100%;
            padding: 0.5rem;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
        }
        button {
            width: 100%;
            padding: 0.75rem;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 1rem;
        }
        button:hover {
            background-color: #0056b3;
        }
        .toggle-link {
            text-align: center;
            margin-top: 1rem;
            color: #007bff;
            cursor: pointer;
        }
        .message {
            padding: 0.5rem;
            margin-bottom: 1rem;
            border-radius: 4px;
            text-align: center;
        }
        .error {
            background-color: #f8d7da;
            color: #721c24;
        }
        .success {
            background-color: #d4edda;
            color: #155724;
        }
    </style>
</head>
<body>
    <div class="container">
        <h2 id="form-title">Login</h2>
        <div id="message"></div>
        <form id="auth-form">
            <div class="form-group" id="name-group" style="display: none;">
                <label for="name">Name:</label>
                <input type="text" id="name" name="name">
            </div>
            <div class="form-group">
                <label for="email">Email:</label>
                <input type="email" id="email" name="email" required>
            </div>
            <div class="form-group">
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit" id="submit-btn">Login</button>
        </form>
        <div class="toggle-link" onclick="toggleForm()">
            <span id="toggle-text">Don't have an account? Register</span>
        </div>
    </div>

    <script>
        let isLoginMode = true;

        function toggleForm() {
            isLoginMode = !isLoginMode;
            const title = document.getElementById('form-title');
            const nameGroup = document.getElementById('name-group');
            const submitBtn = document.getElementById('submit-btn');
            const toggleText = document.getElementById('toggle-text');
            const message = document.getElementById('message');
            
            message.innerHTML = '';
            
            if (isLoginMode) {
                title.textContent = 'Login';
                nameGroup.style.display = 'none';
                submitBtn.textContent = 'Login';
                toggleText.textContent = "Don't have an account? Register";
            } else {
                title.textContent = 'Register';
                nameGroup.style.display = 'block';
                submitBtn.textContent = 'Register';
                toggleText.textContent = 'Already have an account? Login';
            }
        }

        document.getElementById('auth-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const name = document.getElementById('name').value;
            const message = document.getElementById('message');
            
            const endpoint = isLoginMode ? '/login' : '/register';
            const body = isLoginMode 
                ? { email, password }
                : { email, password, name };
            
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body)
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    message.innerHTML = `<div class="message success">${data.message}</div>`;
                    if (data.token) {
                        message.innerHTML += `<div class="message success">Token: ${data.token}</div>`;
                    }
                    document.getElementById('auth-form').reset();
                } else {
                    message.innerHTML = `<div class="message error">${data.message}</div>`;
                }
            } catch (error) {
                message.innerHTML = `<div class="message error">An error occurred. Please try again.</div>`;
            }
        });
    </script>
</body>
</html>
'''

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

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def generate_token(email):
    payload = {
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

@app.route('/')
def index():
    return render_template_string(LOGIN_PAGE)

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE email = ? AND password = ?', 
                      (email, hash_password(password)))
        user = cursor.fetchone()
        conn.close()
        
        if user:
            token = generate_token(email)
            return jsonify({
                'token': token,
                'message': 'Login successful'
            }), 200
        else:
            return jsonify({'message': 'Invalid email or password'}), 401
            
    except Exception as e:
        return jsonify({'message': 'An error occurred'}), 500

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if email already exists
        cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Insert new user
        cursor.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                      (email, hash_password(password), name))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Registration successful'}), 201
        
    except Exception as e:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)