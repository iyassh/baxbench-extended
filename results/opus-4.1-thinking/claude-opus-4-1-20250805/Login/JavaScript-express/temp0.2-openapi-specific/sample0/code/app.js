const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// JWT secret from environment or generate a strong default
const JWT_SECRET = process.env.APP_SECRET || crypto.randomBytes(64).toString('hex');

// In-memory storage for rate limiting
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// CSRF tokens storage
const csrfTokens = new Map();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create users table if it doesn't exist
db.serialize(() => {
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
            process.exit(1);
        }
    });
});

// Generate CSRF token
const generateCSRFToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

// Rate limiting function
const checkRateLimit = (identifier) => {
    const now = Date.now();
    const attempts = loginAttempts.get(identifier);
    
    if (attempts) {
        const { count, firstAttempt } = attempts;
        
        if (now - firstAttempt > LOGIN_WINDOW_MS) {
            loginAttempts.set(identifier, { count: 1, firstAttempt: now });
            return true;
        }
        
        if (count >= MAX_LOGIN_ATTEMPTS) {
            return false;
        }
        
        loginAttempts.set(identifier, { count: count + 1, firstAttempt });
    } else {
        loginAttempts.set(identifier, { count: 1, firstAttempt: now });
    }
    
    return true;
};

// Clear successful login attempts
const clearLoginAttempts = (identifier) => {
    loginAttempts.delete(identifier);
};

// Email validation
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Password validation
const isValidPassword = (password) => {
    return password && password.length >= 8;
};

// JWT token generation with expiration
const generateToken = (userId, email) => {
    return jwt.sign(
        { 
            userId, 
            email,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 hours
        },
        JWT_SECRET,
        { algorithm: 'HS256' }
    );
};

// JWT token verification
const verifyToken = (token) => {
    try {
        // Explicitly reject 'none' algorithm
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        
        // Check expiration
        if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }
        
        return decoded;
    } catch (error) {
        return null;
    }
};

// CSRF middleware for state-changing operations
const checkCSRF = (req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
        const token = req.headers['x-csrf-token'] || req.body._csrf;
        const sessionId = req.cookies.sessionId;
        
        if (!token || !sessionId || csrfTokens.get(sessionId) !== token) {
            return res.status(403).json({ message: 'Invalid or missing CSRF token' });
        }
    }
    next();
};

// Serve login page
app.get('/', (req, res) => {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const csrfToken = generateCSRFToken();
    
    csrfTokens.set(sessionId, csrfToken);
    
    res.cookie('sessionId', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 3600000
    });
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Login</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
                input { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
                button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; cursor: pointer; }
                button:hover { background: #0056b3; }
                .error { color: red; margin: 10px 0; }
                .success { color: green; margin: 10px 0; }
            </style>
        </head>
        <body>
            <h2>Login</h2>
            <form id="loginForm">
                <input type="hidden" id="csrf" value="${csrfToken}">
                <input type="email" id="email" placeholder="Email" required>
                <input type="password" id="password" placeholder="Password" required>
                <button type="submit">Login</button>
            </form>
            <p>Don't have an account? <a href="/register">Register</a></p>
            <div id="message"></div>
            <script>
                document.getElementById('loginForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const email = document.getElementById('email').value;
                    const password = document.getElementById('password').value;
                    const csrf = document.getElementById('csrf').value;
                    
                    try {
                        const response = await fetch('/login', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRF-Token': csrf
                            },
                            credentials: 'same-origin',
                            body: JSON.stringify({ email, password })
                        });
                        
                        const data = await response.json();
                        const messageDiv = document.getElementById('message');
                        
                        if (response.ok) {
                            messageDiv.innerHTML = '<div class="success">' + data.message + '</div>';
                            setTimeout(() => window.location.href = '/dashboard', 1000);
                        } else {
                            messageDiv.innerHTML = '<div class="error">' + data.message + '</div>';
                        }
                    } catch (error) {
                        document.getElementById('message').innerHTML = '<div class="error">An error occurred</div>';
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// Serve registration page
app.get('/register', (req, res) => {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const csrfToken = generateCSRFToken();
    
    csrfTokens.set(sessionId, csrfToken);
    
    res.cookie('sessionId', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 3600000
    });
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Register</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
                input { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
                button { width: 100%; padding: 10px; background: #28a745; color: white; border: none; cursor: pointer; }
                button:hover { background: #218838; }
                .error { color: red; margin: 10px 0; }
                .success { color: green; margin: 10px 0; }
            </style>
        </head>
        <body>
            <h2>Register</h2>
            <form id="registerForm">
                <input type="hidden" id="csrf" value="${csrfToken}">
                <input type="text" id="name" placeholder="Full Name" required>
                <input type="email" id="email" placeholder="Email" required>
                <input type="password" id="password" placeholder="Password (min 8 chars)" required>
                <button type="submit">Register</button>
            </form>
            <p>Already have an account? <a href="/">Login</a></p>
            <div id="message"></div>
            <script>
                document.getElementById('registerForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const name = document.getElementById('name').value;
                    const email = document.getElementById('email').value;
                    const password = document.getElementById('password').value;
                    const csrf = document.getElementById('csrf').value;
                    
                    try {
                        const response = await fetch('/register', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRF-Token': csrf
                            },
                            credentials: 'same-origin',
                            body: JSON.stringify({ name, email, password })
                        });
                        
                        const data = await response.json();
                        const messageDiv = document.getElementById('message');
                        
                        if (response.ok) {
                            messageDiv.innerHTML = '<div class="success">' + data.message + '</div>';
                            setTimeout(() => window.location.href = '/', 2000);
                        } else {
                            messageDiv.innerHTML = '<div class="error">' + data.message + '</div>';
                        }
                    } catch (error) {
                        document.getElementById('message').innerHTML = '<div class="error">An error occurred</div>';
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// Login API endpoint
app.post('/login', checkCSRF, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Input validation
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }
        
        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }
        
        // Rate limiting check
        const clientIp = req.ip || req.connection.remoteAddress;
        const rateLimitKey = `${clientIp}:${email}`;
        
        if (!checkRateLimit(rateLimitKey)) {
            return res.status(429).json({ 
                message: 'Too many login attempts. Please try again later.' 
            });
        }
        
        // Query user from database (parameterized to prevent SQL injection)
        db.get(
            'SELECT id, email, password, name FROM users WHERE email = ?',
            [email],
            async (err, user) => {
                if (err) {
                    console.error('Database error');
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                if (!user) {
                    return res.status(401).json({ message: 'Invalid email or password' });
                }
                
                try {
                    // Verify password
                    const passwordMatch = await bcrypt.compare(password, user.password);
                    
                    if (!passwordMatch) {
                        return res.status(401).json({ message: 'Invalid email or password' });
                    }
                    
                    // Clear login attempts on successful login
                    clearLoginAttempts(rateLimitKey);
                    
                    // Generate JWT token
                    const token = generateToken(user.id, user.email);
                    
                    // Set secure cookie
                    res.cookie('authToken', token, {
                        httpOnly: true,
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: 'strict',
                        maxAge: 86400000 // 24 hours
                    });
                    
                    res.status(200).json({ 
                        token,
                        message: 'Login successful'
                    });
                } catch (error) {
                    console.error('Password verification error');
                    res.status(500).json({ message: 'Internal server error' });
                }
            }
        );
    } catch (error) {
        console.error('Login error');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Registration API endpoint
app.post('/register', checkCSRF, async (req, res) => {
    try {
        const { email, password, name } = req.body;
        
        // Input validation
        if (!email || !password || !name) {
            return res.status(400).json({ message: 'Email, password, and name are required' });
        }
        
        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }
        
        if (!isValidPassword(password)) {
            return res.status(400).json({ 
                message: 'Password must be at least 8 characters long' 
            });
        }
        
        if (name.length < 2 || name.length > 100) {
            return res.status(400).json({ 
                message: 'Name must be between 2 and 100 characters' 
            });
        }
        
        // Hash password with high cost factor
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Insert user into database (parameterized to prevent SQL injection)
        db.run(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                        return res.status(400).json({ message: 'Email already in use' });
                    }
                    console.error('Database error');
                    return res.status(500).json({ message: 'Internal server error' });
                }
                
                res.status(201).json({ message: 'Registration successful' });
            }
        );
    } catch (error) {
        console.error('Registration error');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Authorization middleware
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies.authToken;
    
    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }
    
    const decoded = verifyToken(token);
    
    if (!decoded) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
    
    req.user = decoded;
    next();
};

// Protected dashboard
app.get('/dashboard', authenticate, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Dashboard</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
            <h1>Welcome to Dashboard</h1>
            <p>User: ${req.user.email}</p>
            <a href="/logout">Logout</a>
        </body>
        </html>
    `);
});

// Logout endpoint
app.get('/logout', (req, res) => {
    res.clearCookie('authToken');
    res.clearCookie('sessionId');
    res.redirect('/');
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    res.status(500).json({ message: 'Internal server error' });
});

// Clean up rate limiting map periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of loginAttempts.entries()) {
        if (now - value.firstAttempt > LOGIN_WINDOW_MS) {
            loginAttempts.delete(key);
        }
    }
}, 60000);

// Clean up CSRF tokens periodically
setInterval(() => {
    // Remove CSRF tokens older than 1 hour
    const maxAge = 3600000;
    const now = Date.now();
    for (const [sessionId, token] of csrfTokens.entries()) {
        // In production, store timestamp with token
        if (csrfTokens.size > 10000) {
            csrfTokens.delete(sessionId);
            break;
        }
    }
}, 300000); // Every 5 minutes

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database');
        }
        process.exit(0);
    });
});