const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(64).toString('hex');
const SALT_ROUNDS = 12;
const JWT_EXPIRY = '1h';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

// Security middleware
app.use(express.json());
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        success BOOLEAN DEFAULT 0
    )`);
});

// Helper function to check login attempts
const checkLoginAttempts = (email, callback) => {
    const cutoffTime = new Date(Date.now() - LOCKOUT_TIME).toISOString();
    db.get(
        `SELECT COUNT(*) as attempts FROM login_attempts 
         WHERE email = ? AND attempt_time > ? AND success = 0`,
        [email, cutoffTime],
        (err, row) => {
            if (err) {
                callback(err, null);
            } else {
                callback(null, row.attempts);
            }
        }
    );
};

// Helper function to record login attempt
const recordLoginAttempt = (email, success) => {
    db.run(
        `INSERT INTO login_attempts (email, success) VALUES (?, ?)`,
        [email, success ? 1 : 0],
        (err) => {
            if (err) {
                console.error('Error recording login attempt:', err.message);
            }
        }
    );
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

// Error handler middleware
const errorHandler = (err, req, res, next) => {
    console.error('Error occurred:', err.message);
    res.status(500).json({ 
        message: 'An error occurred processing your request' 
    });
};

// Login endpoint
app.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        
        // Input validation
        if (!email || !password) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        if (!isValidEmail(email)) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Check login attempts
        checkLoginAttempts(email, async (err, attempts) => {
            if (err) {
                return next(err);
            }
            
            if (attempts >= MAX_LOGIN_ATTEMPTS) {
                return res.status(401).json({ 
                    message: 'Too many failed login attempts. Please try again later.' 
                });
            }
            
            // Query user with parameterized query to prevent SQL injection
            db.get(
                'SELECT * FROM users WHERE email = ?',
                [email],
                async (err, user) => {
                    if (err) {
                        return next(err);
                    }
                    
                    if (!user) {
                        recordLoginAttempt(email, false);
                        return res.status(401).json({ message: 'Invalid email or password' });
                    }
                    
                    try {
                        // Compare password
                        const validPassword = await bcrypt.compare(password, user.password);
                        
                        if (!validPassword) {
                            recordLoginAttempt(email, false);
                            return res.status(401).json({ message: 'Invalid email or password' });
                        }
                        
                        // Generate JWT token with proper configuration
                        const token = jwt.sign(
                            { 
                                id: user.id, 
                                email: user.email 
                            },
                            APP_SECRET,
                            { 
                                expiresIn: JWT_EXPIRY,
                                algorithm: 'HS256'
                            }
                        );
                        
                        recordLoginAttempt(email, true);
                        
                        // Set secure cookie
                        res.cookie('token', token, {
                            httpOnly: true,
                            secure: process.env.NODE_ENV === 'production',
                            sameSite: 'strict',
                            maxAge: 3600000 // 1 hour
                        });
                        
                        res.status(200).json({ 
                            token: token,
                            message: 'Login successful' 
                        });
                    } catch (error) {
                        next(error);
                    }
                }
            );
        });
    } catch (error) {
        next(error);
    }
});

// Register endpoint
app.post('/register', async (req, res, next) => {
    try {
        const { email, password, name } = req.body;
        
        // Input validation
        if (!email || !password || !name) {
            return res.status(400).json({ 
                message: 'Email, password, and name are required' 
            });
        }
        
        if (!isValidEmail(email)) {
            return res.status(400).json({ 
                message: 'Invalid email format' 
            });
        }
        
        if (!isValidPassword(password)) {
            return res.status(400).json({ 
                message: 'Password must be at least 8 characters long' 
            });
        }
        
        if (name.trim().length === 0) {
            return res.status(400).json({ 
                message: 'Name cannot be empty' 
            });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        // Insert user with parameterized query
        db.run(
            'INSERT INTO users (email, password, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ 
                            message: 'Email already in use' 
                        });
                    }
                    return next(err);
                }
                
                res.status(201).json({ 
                    message: 'Registration successful' 
                });
            }
        );
    } catch (error) {
        next(error);
    }
});

// JWT verification middleware
const verifyToken = (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, APP_SECRET, {
            algorithms: ['HS256']
        });
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired' });
        }
        return res.status(401).json({ message: 'Invalid token' });
    }
};

// Apply error handler
app.use(errorHandler);

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});