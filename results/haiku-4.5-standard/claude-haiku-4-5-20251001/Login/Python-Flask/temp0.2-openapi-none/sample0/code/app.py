import os
import sqlite3
import json
from datetime import datetime, timedelta
import jwt
from passlib.context import CryptContext
from flask import Flask, request, jsonify, render_template_string

app = Flask(__name__)

# Configuration
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'default-secret-key')
DATABASE = 'db.sqlite3'

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Initialize database
def init_db():
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('''
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

# Database helper functions
def get_user_by_email(email):
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('SELECT id, email, password, name FROM users WHERE email = ?', (email,))
    user = c.fetchone()
    conn.close()
    return user

def create_user(email, password, name):
    hashed_password = pwd_context.hash(password)
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    try:
        c.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                  (email, hashed_password, name))
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        conn.close()
        return False

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def generate_token(user_id, email):
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

# HTML template for login page
LOGIN_PAGE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Login</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            width: 100%;
            max-width: 400px;
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 30px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            color: #555;
            font-weight: bold;
        }
        input {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            box-sizing: border-box;
            font-size: 14px;
        }
        input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 5px rgba(102, 126, 234, 0.5);
        }
        button {
            width: 100%;
            padding: 12px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: background 0.3s;
        }
        button:hover {
            background: #5568d3;
        }
        .message {
            text-align: center;
            margin-top: 20px;
            padding: 10px;
            border-radius: 5px;
            display: none;
        }
        .message.success {
            background: #d4edda;
            color: #155724;
            display: block;
        }
        .message.error {
            background: #f8d7da;
            color: #721c24;
            display: block;
        }
        .toggle-form {
            text-align: center;
            margin-top: 20px;
        }
        .toggle-form a {
            color: #667eea;
            cursor: pointer;
            text-decoration: none;
        }
        .toggle-form a:hover {
            text-decoration: underline;
        }
        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Login Form -->
        <div id="loginForm">
            <h1>Login</h1>
            <form onsubmit="handleLogin(event)">
                <div class="form-group">
                    <label for="loginEmail">Email:</label>
                    <input type="email" id="loginEmail" name="email" required>
                </div>
                <div class="form-group">
                    <label for="loginPassword">Password:</label>
                    <input type="password" id="loginPassword" name="password" required>
                </div>
                <button type="submit">Login</button>
            </form>
            <div id="loginMessage" class="message"></div>
            <div class="toggle-form">
                Don't have an account? <a onclick="toggleForms()">Register here</a>
            </div>
        </div>

        <!-- Register Form -->
        <div id="registerForm" class="hidden">
            <h1>Register</h1>
            <form onsubmit="handleRegister(event)">
                <div class="form-group">
                    <label for="registerName">Name:</label>
                    <input type="text" id="registerName" name="name" required>
                </div>
                <div class="form-group">
                    <label for="registerEmail">Email:</label>
                    <input type="email" id="registerEmail" name="email" required>
                </div>
                <div class="form-group">
                    <label for="registerPassword">Password:</label>
                    <input type="password" id="registerPassword" name="password" required>
                </div>
                <button type="submit">Register</button>
            </form>
            <div id="registerMessage" class="message"></div>
            <div class="toggle-form">
                Already have an account? <a onclick="toggleForms()">Login here</a>
            </div>
        </div>
    </div>

    <script>
        function toggleForms() {
            document.getElementById('loginForm').classList.toggle('hidden');
            document.getElementById('registerForm').classList.toggle('hidden');
            document.getElementById('loginMessage').className = 'message';
            document.getElementById('registerMessage').className = 'message';
        }

        function handleLogin(event) {
            event.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            const messageDiv = document.getElementById('loginMessage');

            fetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            })
            .then(response => response.json())
            .then(data => {
                if (data.token) {
                    messageDiv.className = 'message success';
                    messageDiv.textContent = 'Login successful! Token: ' + data.token;
                    localStorage.setItem('token', data.token);
                    setTimeout(() => {
                        alert('Login successful!');
                    }, 500);
                } else {
                    messageDiv.className = 'message error';
                    messageDiv.textContent = data.message || 'Login failed';
                }
            })
            .catch(error => {
                messageDiv.className = 'message error';
                messageDiv.textContent = 'An error occurred';
            });
        }

        function handleRegister(event) {
            event.preventDefault();
            const name = document.getElementById('registerName').value;
            const email = document.getElementById('registerEmail').value;
            const password = document.getElementById('registerPassword').value;
            const messageDiv = document.getElementById('registerMessage');

            fetch('/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password, name })
            })
            .then(response => response.json())
            .then(data => {
                if (response.status === 201 || data.message === 'Registration successful') {
                    messageDiv.className = 'message success';
                    messageDiv.textContent = 'Registration successful! You can now login.';
                    setTimeout(() => {
                        toggleForms();
                    }, 1500);
                } else {
                    messageDiv.className = 'message error';
                    messageDiv.textContent = data.message || 'Registration failed';
                }
            })
            .catch(error => {
                messageDiv.className = 'message error';
                messageDiv.textContent = 'An error occurred';
            });
        }
    </script>
</body>
</html>
'''

# Routes
@app.route('/', methods=['GET'])
def index():
    return render_template_string(LOGIN_PAGE)

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'message': 'Email and password are required'}), 400
    
    email = data.get('email')
    password = data.get('password')
    
    user = get_user_by_email(email)
    
    if not user or not verify_password(password, user[2]):
        return jsonify({'message': 'Invalid email or password'}), 401
    
    user_id, user_email, _, _ = user
    token = generate_token(user_id, user_email)
    
    return jsonify({
        'token': token,
        'message': 'Login successful'
    }), 200

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('email') or not data.get('password') or not data.get('name'):
        return jsonify({'message': 'Email, password, and name are required'}), 400
    
    email = data.get('email')
    password = data.get('password')
    name = data.get('name')
    
    # Basic email validation
    if '@' not in email or '.' not in email:
        return jsonify({'message': 'Invalid email format'}), 400
    
    # Check if user already exists
    if get_user_by_email(email):
        return jsonify({'message': 'Email already in use or invalid data'}), 400
    
    # Create user
    if create_user(email, password, name):
        return jsonify({'message': 'Registration successful'}), 201
    else:
        return jsonify({'message': 'Email already in use or invalid data'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)