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
const SALT_ROUNDS = 10;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create users table with login attempts tracking
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            login_attempts INTEGER DEFAULT 0,
            last_attempt_time INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// Helper function to check if account is locked
function isAccountLocked(lastAttemptTime, loginAttempts) {
    if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        const timeSinceLastAttempt = Date.now() - lastAttemptTime;
        return timeSinceLastAttempt < LOCKOUT_TIME;
    }
    return false;
}

// Helper function to reset login attempts
function resetLoginAttempts(email, callback) {
    const stmt = db.prepare('UPDATE users SET login_attempts = 0, last_attempt_time = 0 WHERE email = ?');
    stmt.run(email, callback);
    stmt.finalize();
}

// Helper function to increment login attempts
function incrementLoginAttempts(email, callback) {
    const stmt = db.prepare('UPDATE users SET login_attempts = login_attempts + 1, last_attempt_time = ? WHERE email = ?');
    stmt.run(Date.now(), email, callback);
    stmt.finalize();
}

// Login endpoint
app.post('/login', async (req, res) => {
    try {
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

        // Use parameterized query to prevent SQL injection
        const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
        stmt.get(email, async (err, user) => {
            stmt.finalize();
            
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid email or password' });
            }

            // Check if account is locked
            if (isAccountLocked(user.last_attempt_time, user.login_attempts)) {
                const remainingTime = Math.ceil((LOCKOUT_TIME - (Date.now() - user.last_attempt_time)) / 60000);
                return res.status(401).json({ 
                    message: `Account locked. Please try again in ${remainingTime} minutes.` 
                });
            }

            try {
                // Verify password
                const validPassword = await bcrypt.compare(password, user.password);
                
                if (!validPassword) {
                    // Increment failed login attempts
                    incrementLoginAttempts(email, (err) => {
                        if (err) {
                            console.error('Failed to update login attempts');
                        }
                    });
                    return res.status(401).json({ message: 'Invalid email or password' });
                }

                // Reset login attempts on successful login
                resetLoginAttempts(email, (err) => {
                    if (err) {
                        console.error('Failed to reset login attempts');
                    }
                });

                // Generate JWT token with expiration
                const token = jwt.sign(
                    { 
                        id: user.id, 
                        email: user.email,
                        iat: Math.floor(Date.now() / 1000)
                    },
                    APP_SECRET,
                    { 
                        expiresIn: '24h',
                        algorithm: 'HS256'
                    }
                );

                // Set secure cookie with token
                res.cookie('token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    maxAge: 24 * 60 * 60 * 1000 // 24 hours
                });

                res.status(200).json({ 
                    token: token,
                    message: 'Login successful' 
                });
            } catch (error) {
                console.error('Password verification error');
                res.status(500).json({ message: 'Internal server error' });
            }
        });
    } catch (error) {
        console.error('Login error');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Register endpoint
app.post('/register', async (req, res) => {
    try {
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

        // Password strength validation
        if (password.length < 8) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Name validation
        if (name.trim().length === 0 || name.length > 100) {
            return res.status(400).json({ message: 'Email already in use or invalid data' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // Use parameterized query to prevent SQL injection
        const checkStmt = db.prepare('SELECT email FROM users WHERE email = ?');
        checkStmt.get(email, (err, existingUser) => {
            checkStmt.finalize();
            
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ message: 'Internal server error' });
            }

            if (existingUser) {
                return res.status(400).json({ message: 'Email already in use or invalid data' });
            }

            // Insert new user with parameterized query
            const insertStmt = db.prepare('INSERT INTO users (email, password, name) VALUES (?, ?, ?)');
            insertStmt.run(email, hashedPassword, name, function(err) {
                insertStmt.finalize();
                
                if (err) {
                    console.error('Registration error:', err.message);
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ message: 'Email already in use or invalid data' });
                    }
                    return res.status(500).json({ message: 'Internal server error' });
                }

                res.status(201).json({ message: 'Registration successful' });
            });
        });
    } catch (error) {
        console.error('Registration error');
        res.status(500).json({ message: 'Internal server error' });
    }
});

// JWT verification middleware for protected routes
function verifyToken(req, res, next) {
    const token = req.cookies.token || req.headers['authorization']?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    try {
        // Verify token with strong algorithm check
        const decoded = jwt.verify(token, APP_SECRET, {
            algorithms: ['HS256']
        });
        
        // Check token expiration
        if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
            return res.status(401).json({ message: 'Token expired' });
        }
        
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid token' });
    }
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ message: 'Internal server error' });
});

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