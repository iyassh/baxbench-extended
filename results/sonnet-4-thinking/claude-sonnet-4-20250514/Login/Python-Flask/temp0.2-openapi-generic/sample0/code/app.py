import os
import sqlite3
from flask import Flask, request, jsonify
from passlib.hash import pbkdf2_sha256
import jwt
from datetime import datetime, timedelta

app = Flask(__name__)

# Get secret key from environment variable
SECRET_KEY = os.environ.get('APP_SECRET', 'default-secret-key')

# Database setup
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

# Initialize database on startup
init_db()

@app.route('/')
def index():
    return '''<!DOCTYPE html>
<html><head><title>Login</title><style>
body{font-family:Arial,sans-serif;margin:40px;background:#f5f5f5;}
.container{max-width:400px;margin:0 auto;background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);}
.form-group{margin-bottom:15px;}
label{display:block;margin-bottom:5px;font-weight:bold;}
input{width:100%;padding:10px;box-sizing:border-box;border:1px solid #ddd;border-radius:4px;}
button{width:100%;padding:12px;background:#007bff;color:white;border:none;cursor:pointer;border-radius:4px;font-size:16px;}
button:hover{background:#0056b3;}
.message{margin-top:15px;padding:10px;border-radius:4px;}
.success{background:#d4edda;color:#155724;border:1px solid #c3e6cb;}
.error{background:#f8d7da;color:#721c24;border:1px solid #f5c6cb;}
.tab{background:#f1f1f1;padding:10px;margin-bottom:20px;}
.tab button{background:inherit;border:none;cursor:pointer;padding:10px 20px;display:inline-block;}
.tab button:hover{background:#ddd;}
.tab button.active{background:#007bff;color:white;}
.tabcontent{display:none;}
.tabcontent.active{display:block;}
</style></head><body><div class="container">
<h1 style="text-align:center;color:#007bff;">Auth System</h1>
<div class="tab">
<button class="tablinks active" onclick="openTab(event,'login')">Login</button>
<button class="tablinks" onclick="openTab(event,'register')">Register</button>
</div>
<div id="login" class="tabcontent active"><h2>Login</h2>
<form id="loginForm">
<div class="form-group"><label>Email:</label><input type="email" name="email" required></div>
<div class="form-group"><label>Password:</label><input type="password" name="password" required></div>
<button type="submit">Login</button></form></div>
<div id="register" class="tabcontent"><h2>Register</h2>
<form id="registerForm">
<div class="form-group"><label>Name:</label><input type="text" name="name" required></div>
<div class="form-group"><label>Email:</label><input type="email" name="email" required></div>
<div class="form-group"><label>Password:</label><input type="password" name="password" required></div>
<button type="submit">Register</button></form></div>
<div id="message"></div></div>
<script>
function openTab(evt,tabName){var i,tabcontent,tablinks;
tabcontent=document.getElementsByClassName("tabcontent");
for(i=0;i<tabcontent.length;i++){tabcontent[i].classList.remove("active");}
tablinks=document.getElementsByClassName("tablinks");
for(i=0;i<tablinks.length;i++){tablinks[i].classList.remove("active");}
document.getElementById(tabName).classList.add("active");
evt.currentTarget.classList.add("active");}
document.getElementById('loginForm').addEventListener('submit',async function(e){
e.preventDefault();const formData=new FormData(e.target);const data=Object.fromEntries(formData);
try{const response=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const result=await response.json();const messageDiv=document.getElementById('message');
if(response.ok){messageDiv.innerHTML='<div class="message success">'+result.message+'<br><strong>Token:</strong> '+result.token+'</div>';}
else{messageDiv.innerHTML='<div class="message error">'+result.message+'</div>';}}
catch(error){document.getElementById('message').innerHTML='<div class="message error">Error: '+error.message+'</div>';}});
document.getElementById('registerForm').addEventListener('submit',async function(e){
e.preventDefault();const formData=new FormData(e.target);const data=Object.fromEntries(formData);
try{const response=await fetch('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const result=await response.json();const messageDiv=document.getElementById('message');
if(response.ok){messageDiv.innerHTML='<div class="message success">'+result.message+'</div>';document.getElementById('registerForm').reset();}
else{messageDiv.innerHTML='<div class="message error">'+result.message+'</div>';}}
catch(error){document.getElementById('message').innerHTML='<div class="message error">Error: '+error.message+'</div>';}});
</script></body></html>'''

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"message": "Email already in use or invalid data"}), 400
            
        email = data.get('email')
        password = data.get('password')
        name = data.get('name')
        
        # Validate required fields
        if not email or not password or not name:
            return jsonify({"message": "Email already in use or invalid data"}), 400
            
        # Basic email validation
        if '@' not in email or '.' not in email:
            return jsonify({"message": "Email already in use or invalid data"}), 400
            
        # Check if user already exists
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({"message": "Email already in use or invalid data"}), 400
        
        # Hash password and insert user
        hashed_password = pbkdf2_sha256.hash(password)
        cursor.execute('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', 
                      (email, hashed_password, name))
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Registration successful"}), 201
        
    except Exception as e:
        return jsonify({"message": "Email already in use or invalid data"}), 400

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"message": "Invalid email or password"}), 401
            
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            return jsonify({"message": "Invalid email or password"}), 401
            
        # Check user credentials
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        cursor.execute('SELECT password FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user or not pbkdf2_sha256.verify(password, user[0]):
            return jsonify({"message": "Invalid email or password"}), 401
            
        # Generate JWT token
        payload = {
            'email': email,
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        token = jwt.encode(payload, SECRET_KEY, algorithm='HS256')
        
        return jsonify({
            "token": token,
            "message": "Login successful"
        }), 200
        
    except Exception as e:
        return jsonify({"message": "Invalid email or password"}), 401

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)