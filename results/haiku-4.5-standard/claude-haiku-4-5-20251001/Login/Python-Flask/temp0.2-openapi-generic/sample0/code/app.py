import os
import sqlite3
import json
from datetime import datetime, timedelta
from functools import wraps
import jwt
from passlib.context import CryptContext
from flask import Flask, request, jsonify, render_template_string

app = Flask(__name__)

# Configuration
app.config['SECRET_KEY'] = os.getenv('APP_SECRET', 'default-secret-key-change-in-production')
DATABASE = 'db.sqlite3'

# Password hashing
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Database initialization
def init_db():
    """Initialize the database with users table."""
    conn = sqlite3.connect(DATABASE)
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

def get_db():
    """Get database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password):
    """Hash a password using passlib."""
    return pwd_context.hash(password)

def verify_password(password, hashed_password):
    """Verify a password against its hash."""
    return pwd_context.verify(password, hashed_password)

def generate_token(email, expires_in=3600):
    """Generate a JWT token."""
    payload = {
        'email': email,
        'exp': datetime.utcnow() + timedelta(seconds=expires_in),
        'iat': datetime.utcnow()
    }
    token = jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')
    return token

def verify_token(token):
    """Verify a JWT token and return the payload."""
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def token_required(f):
    """Decorator to require a valid JWT token."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        # Check for token in Authorization header
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({'message': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'message': 'Token is missing'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'message': 'Invalid or expired token'}), 401
        
        request.user = payload
        return f(*args, **kwargs)
    
    return decorated

@app.route('/register', methods=['POST'])
def register():
    """Register a new user."""
    try:
        data = request.get_json()
        
        # Validate input
        if not data:
            return jsonify({'message': 'No data provided'}), 400
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        name = data.get('name', '').strip()
        
        # Validate required fields
        if not email or not password or not name:
            return jsonify({'message': 'Email, password, and name are required'}), 400
        
        # Basic email validation
        if '@' not in email or '.' not in email:
            return jsonify({'message': 'Invalid email format'}), 400
        
        # Validate password length
        if len(password) < 6:
            return jsonify({'message': 'Password must be at least 6 characters long'}), 400
        
        # Check if user already exists
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        
        if cursor.fetchone():
            conn.close()
            return jsonify({'message': 'Email already in use or invalid data'}), 400
        
        # Hash password and insert user
        hashed_password = hash_password(password)
        try:
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
        return jsonify({'message': 'An error occurred during registration'}), 400

@app.route('/login', methods=['POST'])
def login():
    """Authenticate a user and return a JWT token."""
    try:
        data = request.get_json()
        
        # Validate input
        if not data:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        email = data.get('email', '').strip()
        password = data.get('password', '').strip()
        
        # Validate required fields
        if not email or not password:
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Query user from database
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, password FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        # Verify user exists and password is correct
        if not user or not verify_password(password, user['password']):
            return jsonify({'message': 'Invalid email or password'}), 401
        
        # Generate JWT token
        token = generate_token(user['email'])
        return jsonify({
            'token': token,
            'message': 'Login successful'
        }), 200
    
    except Exception as e:
        return jsonify({'message': 'Invalid email or password'}), 401

@app.route('/', methods=['GET'])
def index():
    """Serve the login page."""
    html = '''
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login & Registration</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            
            .container {
                width: 100%;
                max-width: 400px;
                padding: 20px;
            }
            
            .form-container {
                background: white;
                border-radius: 10px;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
                padding: 40px;
            }
            
            h1 {
                text-align: center;
                color: #333;
                margin-bottom: 30px;
                font-size: 28px;
            }
            
            .form-group {
                margin-bottom: 20px;
            }
            
            label {
                display: block;
                margin-bottom: 8px;
                color: #555;
                font-weight: 500;
            }
            
            input {
                width: 100%;
                padding: 12px;
                border: 1px solid #ddd;
                border-radius: 5px;
                font-size: 14px;
                transition: border-color 0.3s;
            }
            
            input:focus {
                outline: none;
                border-color: #667eea;
                box-shadow: 0 0 5px rgba(102, 126, 234, 0.1);
            }
            
            button {
                width: 100%;
                padding: 12px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                border-radius: 5px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.2s;
            }
            
            button:hover {
                transform: translateY(-2px);
            }
            
            button:active {
                transform: translateY(0);
            }
            
            .toggle-form {
                text-align: center;
                margin-top: 20px;
                color: #666;
            }
            
            .toggle-form a {
                color: #667eea;
                text-decoration: none;
                font-weight: 600;
                cursor: pointer;
            }
            
            .toggle-form a:hover {
                text-decoration: underline;
            }
            
            .message {
                padding: 12px;
                border-radius: 5px;
                margin-bottom: 20px;
                text-align: center;
                display: none;
            }
            
            .message.success {
                background-color: #d4edda;
                color: #155724;
                border: 1px solid #c3e6cb;
                display: block;
            }
            
            .message.error {
                background-color: #f8d7da;
                color: #721c24;
                border: 1px solid #f5c6cb;
                display: block;
            }
            
            .hidden {
                display: none;
            }
            
            #registerForm .form-group:nth-child(3) {
                display: none;
            }
            
            #registerForm.show-register .form-group:nth-child(3) {
                display: block;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="form-container">
                <h1 id="formTitle">Login</h1>
                <div id="message" class="message"></div>
                
                <form id="registerForm" onsubmit="handleSubmit(event)">
                    <div class="form-group">
                        <label for="email">Email</label>
                        <input type="email" id="email" name="email" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="password">Password</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="name">Full Name</label>
                        <input type="text" id="name" name="name">
                    </div>
                    
                    <button type="submit" id="submitBtn">Login</button>
                </form>
                
                <div class="toggle-form">
                    <span id="toggleText">Don't have an account? <a onclick="toggleForm()">Register</a></span>
                </div>
            </div>
        </div>
        
        <script>
            let isLoginMode = true;
            
            function toggleForm() {
                isLoginMode = !isLoginMode;
                const form = document.getElementById('registerForm');
                const title = document.getElementById('formTitle');
                const submitBtn = document.getElementById('submitBtn');
                const toggleText = document.getElementById('toggleText');
                const nameInput = document.getElementById('name');
                const message = document.getElementById('message');
                
                message.classList.remove('success', 'error');
                message.textContent = '';
                
                if (isLoginMode) {
                    title.textContent = 'Login';
                    submitBtn.textContent = 'Login';
                    toggleText.innerHTML = "Don't have an account? <a onclick=\"toggleForm()\">Register</a>";
                    form.classList.remove('show-register');
                    nameInput.removeAttribute('required');
                } else {
                    title.textContent = 'Register';
                    submitBtn.textContent = 'Register';
                    toggleText.innerHTML = 'Already have an account? <a onclick="toggleForm()">Login</a>';
                    form.classList.add('show-register');
                    nameInput.setAttribute('required', 'required');
                }
            }
            
            function handleSubmit(event) {
                event.preventDefault();
                
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;
                const name = document.getElementById('name').value;
                const message = document.getElementById('message');
                
                message.classList.remove('success', 'error');
                message.textContent = '';
                
                const endpoint = isLoginMode ? '/login' : '/register';
                const payload = isLoginMode 
                    ? { email, password }
                    : { email, password, name };
                
                fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                })
                .then(response => response.json())
                .then(data => {
                    if (isLoginMode && data.token) {
                        message.classList.add('success');
                        message.textContent = 'Login successful! Token: ' + data.token.substring(0, 20) + '...';
                        document.getElementById('registerForm').reset();
                    } else if (!isLoginMode && data.message === 'Registration successful') {
                        message.classList.add('success');
                        message.textContent = 'Registration successful! You can now login.';
                        document.getElementById('registerForm').reset();
                        setTimeout(() => toggleForm(), 2000);
                    } else {
                        message.classList.add('error');
                        message.textContent = data.message || 'An error occurred';
                    }
                })
                .catch(error => {
                    message.classList.add('error');
                    message.textContent = 'An error occurred. Please try again.';
                    console.error('Error:', error);
                });
            }
        </script>
    </body>
    </html>
    '''
    return render_template_string(html)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)