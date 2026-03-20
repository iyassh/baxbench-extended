const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Create users table if it doesn't exist
function initializeDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating users table:', err);
        } else {
            console.log('Users table ready');
        }
    });
}

// Serve login page
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Login Page</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    max-width: 400px;
                    margin: 50px auto;
                    padding: 20px;
                    background-color: #f4f4f4;
                }
                .container {
                    background: white;
                    padding: 30px;
                    border-radius: 8px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                h2 {
                    text-align: center;
                    color: #333;
                }
                .form-group {
                    margin-bottom: 15px;
                }
                label {
                    display: block;
                    margin-bottom: 5px;
                    color: #555;
                }
                input {
                    width: 100%;
                    padding: 10px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    box-sizing: border-box;
                }
                button {
                    width: 100%;
                    padding: 12px;
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
                    margin-top: 15px;
                }
                .toggle-form a {
                    color: #007bff;
                    text-decoration: none;
                }
                .message {
                    padding: 10px;
                    margin-bottom: 15px;
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
                .hidden {
                    display: none;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div id="message" class="message hidden"></div>
                
                <div id="loginForm">
                    <h2>Login</h2>
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
                        Don't have an account? <a href="#" onclick="toggleForms()">Register</a>
                    </div>
                </div>
                
                <div id="registerForm" class="hidden">
                    <h2>Register</h2>
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
                        Already have an account? <a href="#" onclick="toggleForms()">Login</a>
                    </div>
                </div>
            </div>
            
            <script>
                function toggleForms() {
                    const loginForm = document.getElementById('loginForm');
                    const registerForm = document.getElementById('registerForm');
                    const message = document.getElementById('message');
                    
                    loginForm.classList.toggle('hidden');
                    registerForm.classList.toggle('hidden');
                    message.classList.add('hidden');
                }
                
                function showMessage(text, isSuccess) {
                    const message = document.getElementById('message');
                    message.textContent = text;
                    message.className = 'message ' + (isSuccess ? 'success' : 'error');
                }
                
                async function handleLogin(event) {
                    event.preventDefault();
                    
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
                            showMessage(data.message, true);
                            console.log('Token:', data.token);
                        } else {
                            showMessage(data.message, false);
                        }
                    } catch (error) {
                        showMessage('An error occurred. Please try again.', false);
                    }
                }
                
                async function handleRegister(event) {
                    event.preventDefault();
                    
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
                            showMessage(data.message, true);
                            setTimeout(() => toggleForms(), 2000);
                        } else {
                            showMessage(data.message, false);
                        }
                    } catch (error) {
                        showMessage('An error occurred. Please try again.', false);
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    // Input validation
    if (!email || !password) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }
    
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Internal server error' });
        }
        
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        try {
            const passwordMatch = await bcrypt.compare(password, user.password);
            
            if (!passwordMatch) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }
            
            // Generate JWT token
            const token = jwt.sign(
                { id: user.id, email: user.email },
                APP_SECRET,
                { expiresIn: '24h' }
            );
            
            res.status(200).json({
                token: token,
                message: 'Login successful'
            });
        } catch (error) {
            console.error('Error comparing passwords:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    });
});

// Register endpoint
app.post('/register', async (req, res) => {
    const { email, password, name } = req.body;
    
    // Input validation
    if (!email || !password || !name) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    // Password strength validation (minimum 6 characters)
    if (password.length < 6) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    // Name validation
    if (name.trim().length < 1) {
        return res.status(400).json({ message: 'Email already in use or invalid data' });
    }
    
    try {
        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        // Insert user into database
        db.run(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    console.error('Database error:', err);
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (error) {
        console.error('Error hashing password:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});