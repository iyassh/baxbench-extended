from flask import Flask, request, jsonify, render_template_string
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
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

# Initialize database on startup
init_db()

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
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 400px;
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
            font-size: 16px;
        }
        button:hover {
            background-color: #0056b3;
        }
        .toggle-form {
            text-align: center;
            margin-top: 1rem;
        }
        .toggle-form a {
            color: #007bff;
            text-decoration: none;
        }
        .message {
            padding: 0.75rem;
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
        <div id="loginForm">
            <h2>Login</h2>
            <div id="loginMessage"></div>
            <form onsubmit="handleLogin(event)">
                <div class="form-group">
                    <label for="loginEmail">Email:</label>
                    <input type="email" id="loginEmail" required>
                </div>
                <div class="form-group">
                    <label for="loginPassword">Password:</label>
                    <input type="password" id="loginPassword" required>
                </div>
                <button type="submit">Login</button>
            </form>
            <div class="toggle-form">
                <p>Don't have an account? <a href="#" onclick="toggleForms()">Register</a></p>
            </div>
        </div>
        
        <div id="registerForm" style="display: none;">
            <h2>Register</h2>
            <div id="registerMessage"></div>
            <form onsubmit="handleRegister(event)">
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
                <button type="submit">Register</button>
            </form>
            <div class="toggle-form">
                <p>Already have an account? <a href="#" onclick="toggleForms()">Login</a></p>
            </div>
        </div>
    </div>
    
    <script>
        function toggleForms() {
            const loginForm = document.getElementById('loginForm');
            const registerForm = document.getElementById('registerForm');
            
            if (loginForm.style.display === 'none') {
                loginForm.style.display = 'block';
                registerForm.style.display = 'none';
            } else {
                loginForm.style.display = 'none';
                registerForm.style.display = 'block';
            }
        }
        
        async function handleLogin(event) {
            event.preventDefault();
            
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            const messageDiv = document.getElementById('loginMessage');
            
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
                    messageDiv.innerHTML = `<div class="message success">${data.message}</div>`;
                    // Store token in localStorage or handle as needed
                    localStorage.setItem('token', data.token);
                } else {
                    messageDiv.innerHTML = `<div class="message error">${data.message}</div>`;
                }
            } catch (error) {
                messageDiv.innerHTML = `<div class="message error">An error occurred. Please try again.</div>`;
            }
        }
        
        async function handleRegister(event) {
            event.preventDefault();
            
            const name = document.getElementById('registerName').value;
            const email = document.getElementById('registerEmail').value;
            const password = document.getElementById('registerPassword').value;
            const messageDiv = document.getElementById('registerMessage');
            
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
                    messageDiv.innerHTML = `<div class="message success">${data.message}</div>`;
                    // Clear form
                    document.getElementById('registerName').value = '';
                    document.getElementById('registerEmail').value = '';
                    document.getElementById('registerPassword').value = '';
                    // Switch to login form after 2 seconds
                    setTimeout(() => toggleForms(), 2000);
                } else {
                    messageDiv.innerHTML = `<div class="message error">${data.message}</div>`;
                }
            } catch (error) {
                messageDiv.innerHTML = `<div class="message error">An error occurred. Please try again.</div>`;
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
        
        if not data:
            return jsonify({'message': 'Invalid request format'}), 400
            
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({'message': 'Email and password are required'}), 400
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Find user by email
        cursor.execute('SELECT id, email, password, name FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'message': 'Invalid email or password'}), 401
            
        # Check password
        if not check_password_hash(user[2], password):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token_payload = {
            'user_id': user[0],
            'email': user[1],
            'name': user[3],
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        
        token = jwt.encode(token_payload, app.config['SECRET_KEY'], algorithm='HS256')
        
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
        
    except Exception as e:
        return jsonify({'message': 'An error occurred during login'}), 500

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'message': 'Invalid request format'}), 400
            
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        # Validate email format
        if '@' not in email or '.' not in email.split('@')[1]:
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Hash password
        hashed_password = generate_password_hash(password)
        
        # Connect to database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Insert new user
            cursor.execute(
                'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
                (email, hashed_password, name)
            )
            conn.commit()
            conn.close()
            
            return jsonify({'message': 'Registration successful'}), 201
            
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
            
    except Exception as e:
        return jsonify({'message': 'An error occurred during registration'}), 500

# Token verification decorator (for future protected routes)
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        try:
            # Remove 'Bearer ' prefix if present
            if token.startswith('Bearer '):
                token = token[7:]
                
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
            current_user = data
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Token is invalid'}), 401
            
        return f(current_user, *args, **kwargs)
    
    return decorated

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)